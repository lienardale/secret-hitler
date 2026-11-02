/**
 * Persistent state of one room, stored as a single JSON row by the GameRoom
 * Durable Object (moves, chat and the outbox have their own tables).
 */
import type {
  ChatMessage,
  CloseCode,
  GameResult,
  GameResultPayload,
  IdentityKind,
  Lang,
  RoomSettings,
  Visibility,
} from "@sh/protocol";

import type { GameSeed } from "../games/types";

export interface Member {
  /** Room-scoped id shown to other players (never the account id). */
  pid: string;
  /** Identity key (`u:<id>` or `g:<id>`), used for kicks, blocks and results. */
  key: string;
  kind: IdentityKind;
  sub: string;
  /** Display name, made unique within the room. */
  name: string;
  mod: boolean;
  /** Identity keys this member blocked: their chat is hidden from this member. */
  blocks: string[];
  joinedAt: number;
  /** When the member's last tab disconnected; null while at least one is connected. */
  goneSince: number | null;
}

export interface GameRecord<S> {
  /** UUID, the website's idempotency key for the result. */
  id: string;
  /** 1 for the room's first game, then counts up with rematches. */
  number: number;
  startedAt: number;
  seed: GameSeed;
  /** Seat number → member pid. */
  seats: string[];
  state: S;
  /** Index of the next move row (row 0 holds the setup events). */
  nextMove: number;
  /** Bumped at every new decision; actions must name the current turn. */
  turn: number;
  phaseKey: string;
  /** When the current decision times out, or null without timers. */
  deadline: number | null;
  /** Seats played automatically: away too long (public games) or kicked. */
  auto: boolean[];
  /** Public games: since when fewer than half of the living players are connected. */
  underHalfSince: number | null;
}

export type RoomStatus = "lobby" | "playing" | "ended";

export interface RoomState<S> {
  v: 1;
  code: string;
  visibility: Visibility;
  lang: Lang;
  createdAt: number;
  /** Identity key of the host: the creator, until the host is gone too long. */
  hostKey: string | null;
  /** Since when the host is not connected (null while connected). */
  hostAwaySince: number | null;
  settings: RoomSettings;
  members: Member[];
  /** Lobby: pids of seated members, in seating order. */
  seated: string[];
  /** Identity keys refused for the rest of the room's life. */
  kicked: string[];
  status: RoomStatus;
  /** Public lobby: when the game starts by itself. */
  startsAt: number | null;
  game: GameRecord<S> | null;
  result: GameResult | null;
  endedAt: number | null;
  /** Since when nobody is connected; null while someone is. */
  emptySince: number | null;
  gamesPlayed: number;
}

/** One stored move. Row 0 of each game holds the setup events (no seat, no action). */
export interface MoveRow<A, E> {
  game: number;
  idx: number;
  seat: number | null;
  action: A | null;
  events: E[];
  at: number;
  /** Played by the room: timeout, away player, or forced by the host. */
  auto: boolean;
}

/** One applied move, kept in memory for the game log sent with the result. */
export interface HistoryEntry<A> {
  seat: number;
  action: A;
  at: number;
  auto: boolean;
}

/** A chat message plus its author's identity key, used to apply blocks. */
export interface StoredChat {
  message: ChatMessage;
  authorKey: string | null;
}

export interface OutboxItem {
  id: string;
  kind: "gameResult";
  payload: GameResultPayload;
}

/** What changed and must be sent to clients after a room operation. */
export type Note<E> =
  | { kind: "room" }
  /** The game moved on; `events` are all new events, filtered per viewer when sent. */
  | { kind: "game"; events: E[] }
  /** Everyone gets a fresh welcome (game started or reset). */
  | { kind: "snapshot" }
  | { kind: "chat"; chat: StoredChat }
  | { kind: "close"; pid: string; code: CloseCode };
