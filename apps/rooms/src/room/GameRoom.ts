/**
 * One Durable Object per room code: the effectful shell around RoomCore.
 *
 * Message path: parse → RoomCore (rules) → write to SQLite → send each socket
 * its own projection. External calls (game results and player reports to the
 * website, reports to the lobby) never run in the message path or in an RPC:
 * they happen in the alarm, which also drives turn deadlines, reconnection
 * grace, the start countdown and the final purge.
 *
 * WebSockets use the hibernation API: the object can sleep between messages
 * and rebuild its state from SQLite and the sockets' attachments.
 */
import type { Action, GameEvent, GameState, PlayerView, Projected } from "@sh/engine";
import {
  CLOSE,
  KEEPALIVE_PING,
  KEEPALIVE_PONG,
  MAX_CLIENT_MESSAGE_BYTES,
  clientMessageSchema,
  identityKeySchema,
  moderationActionSchema,
  roomMemberRequestSchema,
  roomReportRequestSchema,
  type CreateRoomRequest,
  type LobbyRoomReport,
  type ModerationAction,
  type RoomInfo,
  type RoomMember,
  type RoomMemberRequest,
  type RoomReportError,
  type RoomReportRequest,
  type VerifiedTicket,
} from "@sh/protocol";
import { DurableObject } from "cloudflare:workers";

import { secretHitler } from "../games/secret-hitler/adapter";
import { LOBBY_NAME } from "../lobby/Lobby";
import { Connections } from "./connections";
import { OUTBOX_GIVE_UP_MS, deliver, retryDelayMs } from "./outbox";
import { RoomCore, createRoomState, type Drained, type RoomDeps } from "./room-core";
import type { HistoryEntry, RoomState } from "./room-state";
import { RoomStore } from "./storage";
import { PLACEMENT } from "../placement";

type Core = RoomCore<GameState, Action, Projected<PlayerView>, GameEvent>;

/** Header carrying the verified ticket from the Worker to the room. */
export const TICKET_HEADER = "x-sh-ticket";

/** Public rooms re-report to the lobby at least this often. */
const LOBBY_KEEPALIVE_MS = 5 * 60_000;
/** Debounce before telling the lobby about a change. */
const LOBBY_DEBOUNCE_MS = 1_000;
/** Malformed messages tolerated per member per minute before closing the socket. */
const MAX_BAD_MESSAGES = 20;

const PID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

const deps: RoomDeps = {
  random: () => (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32,
  seed: () => {
    const [a = 0, b = 0, c = 0, d = 0] = crypto.getRandomValues(new Uint32Array(4));
    return [a, b, c, d];
  },
  pid: () =>
    Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (byte) => PID_ALPHABET[byte % PID_ALPHABET.length],
    ).join(""),
  uuid: () => crypto.randomUUID(),
};

interface LobbySent {
  json: string;
  at: number;
}

export type ReportOutcome = { ok: true } | { ok: false; error: RoomReportError | "no_room" };
export type MemberOutcome =
  | { ok: true; member: RoomMember }
  | { ok: false; error: "no_room" | "unknown_target" | "not_member" };

export class GameRoom extends DurableObject<Env> {
  private readonly store: RoomStore;
  private readonly conns: Connections;
  private core: Core | null;
  private readonly badMessages = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RoomStore(ctx.storage.sql);
    this.conns = new Connections(ctx, env.ENVIRONMENT !== "production");
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_PING, KEEPALIVE_PONG));
    this.core = this.load(Date.now());
  }

  private load(now: number): Core | null {
    const room = this.store.getMeta<RoomState<GameState>>("room");
    if (!room) return null;
    if (room.game) room.game.state = secretHitler.migrate(room.game.state);
    const rows = room.game ? this.store.loadMoves<Action, GameEvent>(room.game.number) : [];
    const history: HistoryEntry<Action>[] = rows.flatMap((row) =>
      row.seat !== null && row.action !== null
        ? [{ seat: row.seat, action: row.action, at: row.at, auto: row.auto }]
        : [],
    );
    const core: Core = new RoomCore(secretHitler, deps, room, {
      log: rows.flatMap((row) => row.events),
      history,
      chat: this.store.loadChat(),
      online: this.conns.onlinePids(),
      now,
    });
    // Reconciling after a restart may have changed the room: persist it (nothing to send yet).
    const out = core.drain();
    if (out.dirty) this.store.setMeta("room", core.room);
    return core;
  }

  // ── RPC from the Worker ────────────────────────────────────────────────

  /** Creates the room. False if this code is already taken. */
  async create(request: CreateRoomRequest): Promise<boolean> {
    if (this.core) return false;
    const code = this.ctx.id.name;
    if (code === undefined) throw new Error("GameRoom must be addressed by room code");
    const now = Date.now();
    const room = createRoomState<GameState>(request, code, now);
    this.store.setMeta("room", room);
    this.core = new RoomCore(secretHitler, deps, room, {
      log: [],
      history: [],
      chat: [],
      online: [],
      now,
    });
    await this.commit(now);
    return true;
  }

  info(): RoomInfo | null {
    return this.core?.info() ?? null;
  }

  /**
   * A member reports another (M5). The report is queued in the outbox and
   * delivered by the alarm, which `commit` schedules right away.
   */
  async report(input: RoomReportRequest): Promise<ReportOutcome> {
    const request = roomReportRequestSchema.parse(input);
    const core = this.core;
    if (!core) return { ok: false, error: "no_room" };
    const now = Date.now();
    const error = core.report(request, now);
    if (error) return { ok: false, error };
    await this.commit(now);
    return { ok: true };
  }

  /** Who is behind a pid, answered only to a member of the room (M5). */
  member(input: RoomMemberRequest): MemberOutcome {
    const request = roomMemberRequestSchema.parse(input);
    const result = this.core?.lookup(request) ?? "no_room";
    return typeof result === "string" ? { ok: false, error: result } : { ok: true, member: result };
  }

  /** A moderator's ban or rename (M5). True when the account was a member here. */
  async moderate(identity: string, input: ModerationAction): Promise<boolean> {
    const key = identityKeySchema.parse(identity);
    const action = moderationActionSchema.parse(input);
    const core = this.core;
    if (!core) return false;
    const now = Date.now();
    const applied = core.moderate(key, action, now);
    await this.commit(now);
    return applied;
  }

  // ── WebSockets ─────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const ticket = JSON.parse(
      request.headers.get(TICKET_HEADER) ?? "null",
    ) as VerifiedTicket | null;
    const { 0: client, 1: server } = new WebSocketPair();
    const refuse = (code: number, reason: string): Response => {
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };

    const core = this.core;
    if (!ticket) return refuse(CLOSE.unauthorized, "missing ticket");
    if (!core) return refuse(CLOSE.roomNotFound, "no such room");
    const now = Date.now();
    if (!this.store.useTicket(ticket.jti, ticket.exp, now)) {
      return refuse(CLOSE.unauthorized, "ticket already used");
    }
    const joined = core.join(ticket, now);
    if (!joined.ok) return refuse(joined.code, "refused");

    this.conns.accept(server, joined.pid);
    this.conns.welcome(server, core, joined.pid, now);
    await this.commit(now);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const core = this.core;
    const pid = this.conns.attachment(ws)?.pid;
    if (!core || !pid) {
      ws.close(core ? CLOSE.badRequest : CLOSE.roomClosed, "no room");
      return;
    }
    let data: unknown = null;
    if (typeof message === "string" && message.length <= MAX_CLIENT_MESSAGE_BYTES) {
      try {
        data = JSON.parse(message);
      } catch {
        data = null;
      }
    }
    const parsed = clientMessageSchema.safeParse(data);
    if (!parsed.success) {
      this.badMessage(ws, pid);
      return;
    }
    const now = Date.now();
    if (parsed.data.t === "sync") {
      this.conns.welcome(ws, core, pid, now);
      return;
    }
    const error = core.handle(pid, parsed.data, now);
    await this.commit(now);
    if (error) this.conns.send(ws, { t: "error", code: error });
  }

  private badMessage(ws: WebSocket, pid: string): void {
    const now = Date.now();
    const recent = [...(this.badMessages.get(pid) ?? []), now].filter((t) => now - t < 60_000);
    this.badMessages.set(pid, recent);
    if (recent.length >= MAX_BAD_MESSAGES) ws.close(CLOSE.badRequest, "too many invalid messages");
    else this.conns.send(ws, { t: "error", code: "invalid_message" });
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Finish the closing handshake (a no-op if the runtime already answered).
    try {
      ws.close(code === 1005 || code === 1006 || code === 1015 ? 1000 : code, "bye");
    } catch {
      // Already closed.
    }
    await this.socketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  private async socketGone(ws: WebSocket): Promise<void> {
    const core = this.core;
    const pid = this.conns.attachment(ws)?.pid;
    if (!core || !pid) return;
    if (this.conns.sockets(pid).some((other) => other !== ws)) return;
    const now = Date.now();
    core.markGone(pid, now);
    await this.commit(now);
  }

  // ── Alarm ──────────────────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    core.tick(now);
    this.persistAndSend(core.drain(), now);
    await this.drainOutbox(now);
    await this.syncLobby(core, now);
    const purgeAt = core.purgeAt();
    if (purgeAt !== null && purgeAt <= now && this.store.outboxSize() === 0) {
      await this.purge();
      return;
    }
    await this.schedule(core, now, false);
  }

  // ── Plumbing ───────────────────────────────────────────────────────────

  /** After any operation: run due rules, persist, send, and set the next alarm. */
  private async commit(now: number): Promise<void> {
    const core = this.core;
    if (!core) return;
    core.tick(now);
    const out = core.drain();
    this.persistAndSend(out, now);
    await this.schedule(core, now, out.lobby || out.outbox.length > 0);
  }

  private persistAndSend(out: Drained<Action, GameEvent>, now: number): void {
    const core = this.core;
    if (!core) return;
    this.ctx.storage.transactionSync(() => {
      if (out.dirty) this.store.setMeta("room", core.room);
      this.store.appendMoves(out.moves);
      this.store.appendChat(out.chat);
      this.store.addOutbox(out.outbox, now);
      if (out.lobby) this.store.setMeta("lobbyDirty", true);
    });
    this.conns.dispatch(core, out.notes, now);
  }

  private async schedule(core: Core, now: number, soon: boolean): Promise<void> {
    const times = [core.nextWakeup(now), this.store.outboxNextAt()];
    // A due purge waits for the outbox to empty; the outbox's own retry time drives the alarm.
    const purgeAt = core.purgeAt();
    if (purgeAt !== null && (purgeAt > now || this.store.outboxSize() === 0)) times.push(purgeAt);
    // Lobby updates are debounced, and never retried faster than the debounce.
    const sent = this.store.getMeta<LobbySent>("lobbySent");
    const listed = core.lobbyReport() !== null;
    if (soon || this.store.getMeta<boolean>("lobbyDirty") || (sent !== null) !== listed) {
      times.push(now + LOBBY_DEBOUNCE_MS);
    } else if (sent && listed) {
      times.push(Math.max(sent.at + LOBBY_KEEPALIVE_MS, now + LOBBY_DEBOUNCE_MS));
    }
    const valid = times.filter((t): t is number => t !== null);
    if (valid.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    // Never in the past: an item that is due but cannot proceed would spin the alarm.
    await this.ctx.storage.setAlarm(Math.max(Math.min(...valid), now + 50));
  }

  private async drainOutbox(now: number): Promise<void> {
    const config = { baseUrl: this.env.WEB_API_URL, secret: this.env.ROOMS_TO_WEB_SECRET };
    for (const item of this.store.dueOutbox(now)) {
      const result = await deliver(item, config);
      if (result === "done") {
        this.store.removeOutbox(item.id);
      } else if (result === "drop" || now - item.createdAt > OUTBOX_GIVE_UP_MS) {
        if (config.baseUrl !== "") console.error(`outbox: dropping ${item.kind} ${item.id}`);
        this.store.removeOutbox(item.id);
      } else {
        const attempts = item.attempts + 1;
        this.store.retryOutbox(item.id, attempts, now + retryDelayMs(attempts));
      }
    }
  }

  /** Public rooms keep the lobby informed: on change (debounced) and every few minutes. */
  private async syncLobby(core: Core, now: number): Promise<void> {
    const report: LobbyRoomReport | null = core.lobbyReport();
    const sent = this.store.getMeta<LobbySent>("lobbySent");
    const lobby = this.env.LOBBY.getByName(LOBBY_NAME, PLACEMENT);
    try {
      if (report === null) {
        if (sent) await lobby.remove(core.room.code);
        this.store.deleteMeta("lobbySent");
      } else {
        const json = JSON.stringify(report);
        if (!sent || sent.json !== json || now - sent.at >= LOBBY_KEEPALIVE_MS) {
          await lobby.report(report);
          this.store.setMeta("lobbySent", { json, at: now } satisfies LobbySent);
        }
      }
      this.store.deleteMeta("lobbyDirty");
    } catch (error) {
      // The lobby is best effort; the next alarm tries again.
      console.error("lobby sync failed", error);
    }
  }

  private async purge(): Promise<void> {
    const core = this.core;
    if (core && this.store.getMeta<LobbySent>("lobbySent")) {
      await this.env.LOBBY.getByName(LOBBY_NAME, PLACEMENT)
        .remove(core.room.code)
        .catch((error: unknown) => console.error("lobby remove failed", error));
    }
    this.conns.closeAll(CLOSE.roomClosed, "room closed");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.store.init();
    this.core = null;
  }
}
