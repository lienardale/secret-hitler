/**
 * Public lobby: a singleton Durable Object that lists the public rooms, pushes
 * the list to viewers over hibernatable WebSockets and answers quick match.
 * See docs/plan.md § Rooms Worker (Lobby DO).
 *
 * Public GameRooms call `report` on every material change and every 5 minutes
 * as a keep-alive, and `remove` when they end, close or go private. A room that
 * stops reporting (crash, deploy) drops out after 11 minutes.
 *
 * Storage budget: the free plan allows ~100k rows written a day, so a room's
 * row is only rewritten when what it reports changes, or when the stored
 * `last_seen` is 4 minutes old (so 5-minute keep-alives still persist and a
 * room never looks expired after an eviction). Everything else is in memory.
 */
import { DurableObject } from "cloudflare:workers";
import {
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  lobbyMessageSchema,
  lobbyRoomReportSchema,
  quickMatchRequestSchema,
  roomCodeSchema,
} from "@sh/protocol";
import type {
  LobbyEntry,
  LobbyMessage,
  LobbyRoomReport,
  QuickMatchRequest,
  QuickMatchResponse,
} from "@sh/protocol";

import { compareRooms, pickRoom } from "./matchmaking";

/** Everyone addresses the lobby as `env.LOBBY.getByName(LOBBY_NAME)`. */
export const LOBBY_NAME = "global";

/** Viewers get at most one list per second. */
export const BROADCAST_INTERVAL_MS = 1_000;
/** A room silent for this long has crashed (keep-alives come every 5 minutes). */
export const EXPIRY_MS = 11 * 60_000;
/** A keep-alive rewrites the row only once the stored `last_seen` is this old. */
export const PERSIST_INTERVAL_MS = 4 * 60_000;

const VIEWER_TAG = "viewer";

interface Room {
  report: LobbyRoomReport;
  /** Last report time; keep-alives refresh it in memory only. */
  lastSeen: number;
  /** The SQL row's report and last_seen, to skip writes that change nothing. */
  stored: string;
  storedAt: number;
  /**
   * Identities quick match sent here since the room's last report, counted as
   * seated so concurrent quick matches spread out and a repeated call returns
   * the same room.
   */
  claims: Set<string>;
}

interface RoomRow extends Record<string, SqlStorageValue> {
  code: string;
  report: string;
  last_seen: number;
}

export class Lobby extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly rooms = new Map<string, Room>();
  /** Viewers have not seen the latest list yet (a broadcast is waiting on the alarm). */
  private dirty = false;
  private lastBroadcastAt = 0;
  /** The alarm this instance set, or null if unknown (fired, or a fresh instance). */
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, report TEXT NOT NULL, last_seen INTEGER NOT NULL)",
    );
    const rows = this.sql.exec<RoomRow>("SELECT code, report, last_seen FROM rooms").toArray();
    for (const row of rows) {
      const report = parseStoredReport(row.report);
      if (!report || report.code !== row.code) {
        // Written by an older schema: drop it, the room re-reports within 5 minutes.
        this.sql.exec("DELETE FROM rooms WHERE code = ?", row.code);
        continue;
      }
      this.rooms.set(row.code, {
        report,
        lastSeen: row.last_seen,
        stored: row.report,
        storedAt: row.last_seen,
        claims: new Set(),
      });
    }
    // Viewers' keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
  }

  /** A public room's current state (on every material change, and every 5 minutes). */
  report(input: LobbyRoomReport): void {
    const report = lobbyRoomReportSchema.parse(input);
    const now = Date.now();
    this.sweep(now);

    const previous = this.rooms.get(report.code);
    const serialized = serializeReport(report);
    let storedAt = previous?.storedAt ?? 0;
    if (previous?.stored !== serialized || now - storedAt >= PERSIST_INTERVAL_MS) {
      this.sql.exec(
        "INSERT INTO rooms (code, report, last_seen) VALUES (?, ?, ?) " +
          "ON CONFLICT (code) DO UPDATE SET report = excluded.report, last_seen = excluded.last_seen",
        report.code,
        serialized,
        now,
      );
      storedAt = now;
    }
    this.rooms.set(report.code, {
      report,
      lastSeen: now,
      stored: serialized,
      storedAt,
      claims: new Set(),
    });

    if (!previous || entryKey(previous.report) !== entryKey(report)) this.changed(now);
    this.reschedule();
  }

  /** The room ended, closed or went private. */
  remove(code: string): void {
    roomCodeSchema.parse(code);
    const now = Date.now();
    this.sweep(now);
    if (this.rooms.delete(code)) {
      this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
      this.changed(now);
    }
    this.reschedule();
  }

  /** The room a player should join, or null (the website then creates one). */
  quickMatch(input: QuickMatchRequest): QuickMatchResponse {
    const request = quickMatchRequestSchema.parse(input);
    this.sweep(Date.now());

    const effective = [...this.rooms.values()].map(({ report, claims }) =>
      claims.size === 0
        ? report
        : {
            ...report,
            players: report.players + claims.size,
            members: [...report.members, ...claims],
          },
    );
    const code = pickRoom(effective, request);
    const room = code === null ? undefined : this.rooms.get(code);
    if (room && !room.report.members.includes(request.identity)) {
      room.claims.add(request.identity);
    }
    this.reschedule();
    return { code };
  }

  /** The list viewers see: waiting rooms first, fullest first, then games in progress. */
  list(): LobbyEntry[] {
    this.sweep(Date.now());
    this.reschedule();
    return this.entries();
  }

  /** Viewer WebSocket (the Worker has already checked the Origin). */
  override fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const now = Date.now();
    this.sweep(now);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [VIEWER_TAG]);
    server.send(this.message(now));
    this.reschedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Viewers have nothing to say; keep-alives are handled by the auto-response. */
  override webSocketMessage(): void {}

  /** Finishes the closing handshake when a viewer leaves. */
  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 || code === 1006 || code === 1015 ? 1000 : code, "bye");
    } catch {
      // Already closed.
    }
  }

  /** One alarm for both jobs: the delayed broadcast and the expiry sweep. */
  override alarm(): void {
    this.alarmAt = null;
    const now = Date.now();
    this.sweep(now);
    if (this.dirty) this.broadcast(now);
    this.reschedule();
  }

  /** Drops rooms that stopped reporting. */
  private sweep(now: number): void {
    let removed = false;
    for (const [code, room] of this.rooms) {
      if (now - room.lastSeen >= EXPIRY_MS) {
        this.rooms.delete(code);
        this.sql.exec("DELETE FROM rooms WHERE code = ?", code);
        removed = true;
      }
    }
    if (removed) this.changed(now);
  }

  /** The viewer-visible list changed: broadcast now, or on the alarm if one went out < 1 s ago. */
  private changed(now: number): void {
    if (this.ctx.getWebSockets(VIEWER_TAG).length === 0) {
      this.dirty = false;
    } else if (now - this.lastBroadcastAt >= BROADCAST_INTERVAL_MS) {
      this.broadcast(now);
    } else {
      this.dirty = true;
    }
  }

  private broadcast(now: number): void {
    this.dirty = false;
    const sockets = this.ctx.getWebSockets(VIEWER_TAG);
    if (sockets.length === 0) return;
    this.lastBroadcastAt = now;
    const data = this.message(now);
    for (const socket of sockets) {
      try {
        socket.send(data);
      } catch {
        // Already closing: the runtime drops it.
      }
    }
  }

  /**
   * Sets the alarm to the earliest pending job. It only ever moves earlier: an
   * alarm that fires with nothing due just reschedules, which costs far less
   * than a storage call on every keep-alive.
   */
  private reschedule(): void {
    let at = this.dirty ? this.lastBroadcastAt + BROADCAST_INTERVAL_MS : Infinity;
    for (const room of this.rooms.values()) at = Math.min(at, room.lastSeen + EXPIRY_MS);
    if (at !== Infinity && (this.alarmAt === null || at < this.alarmAt)) {
      this.alarmAt = at;
      void this.ctx.storage.setAlarm(at);
    }
  }

  private entries(): LobbyEntry[] {
    return [...this.rooms.values()]
      .map(({ report }) => toEntry(report))
      .sort((a, b) => statusRank(a) - statusRank(b) || compareRooms(a, b));
  }

  private message(now: number): string {
    const message: LobbyMessage = { t: "lobby", rooms: this.entries(), serverTime: now };
    // The strict schema throws on any extra field, so a `members` leak fails loudly in dev and tests.
    if (this.env.ENVIRONMENT !== "production") lobbyMessageSchema.parse(message);
    return JSON.stringify(message);
  }
}

/** Copies only the viewer-visible fields: `members` must never reach viewers. */
function toEntry(report: LobbyRoomReport): LobbyEntry {
  return {
    code: report.code,
    lang: report.lang,
    status: report.status,
    players: report.players,
    maxPlayers: report.maxPlayers,
    minPlayers: report.minPlayers,
    timers: report.timers,
    startsAt: report.startsAt,
  };
}

function entryKey(report: LobbyRoomReport): string {
  return JSON.stringify(toEntry(report));
}

/** Stable text for a report (fixed key order, sorted members) to detect real changes. */
function serializeReport(report: LobbyRoomReport): string {
  return JSON.stringify({ ...toEntry(report), members: [...report.members].sort() });
}

function parseStoredReport(text: string): LobbyRoomReport | null {
  try {
    const result = lobbyRoomReportSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function statusRank(entry: LobbyEntry): number {
  return entry.status === "lobby" ? 0 : 1;
}
