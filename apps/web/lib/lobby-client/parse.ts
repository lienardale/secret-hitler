/**
 * The lobby WebSocket's messages, checked by hand: browser code must not
 * import the protocol's zod schemas (they would ship zod to every visitor).
 * The server already validates what it sends against the strict schema; this
 * only guards the UI against a malformed or unexpected frame.
 */
import { LANGS, TIMER_PRESETS, type Lang, type LobbyEntry, type TimerPreset } from "@sh/protocol";

export interface LobbySnapshot {
  rooms: LobbyEntry[];
  serverTime: number;
}

const isInt = (value: unknown): value is number => Number.isInteger(value);

function entry(raw: unknown): LobbyEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== "string" || !/^[A-Z]{5}$/.test(r.code)) return null;
  if (!(LANGS as readonly unknown[]).includes(r.lang)) return null;
  if (r.status !== "lobby" && r.status !== "playing") return null;
  if (!isInt(r.players) || !isInt(r.maxPlayers) || !isInt(r.minPlayers)) return null;
  if (!(TIMER_PRESETS as readonly unknown[]).includes(r.timers)) return null;
  if (r.startsAt !== null && !isInt(r.startsAt)) return null;
  return {
    code: r.code,
    lang: r.lang as Lang,
    status: r.status,
    players: r.players,
    maxPlayers: r.maxPlayers,
    minPlayers: r.minPlayers,
    timers: r.timers as TimerPreset,
    startsAt: r.startsAt as number | null,
  };
}

/** A `{ t: "lobby" }` frame, or null for anything else (pong, garbage). */
export function parseLobbyMessage(data: string): LobbySnapshot | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;
  if (m.t !== "lobby" || !Array.isArray(m.rooms) || !isInt(m.serverTime)) return null;
  const rooms = m.rooms.map(entry).filter((room): room is LobbyEntry => room !== null);
  return { rooms, serverTime: m.serverTime };
}

/** `http://rooms:8787` → `ws://rooms:8787/v1/lobby/ws`. */
export function lobbySocketUrl(roomsPublicUrl: string): string {
  const url = new URL("/v1/lobby/ws", roomsPublicUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
