/**
 * Messages a room sends to one browser. Game data is always a per-player
 * projection (`viewFor`) and the events that player may see.
 */
import type { EngineErrorCode } from "@sh/engine";
import { z } from "zod";

import { chatMessageSchema } from "./chat";
import { gameEventSchema, playerViewSchema } from "./player-view";
import { roomViewSchema } from "./room-view";

export const ROOM_ERROR_CODES = [
  "invalid_message",
  "not_host",
  "wrong_status",
  "room_full",
  "not_seated",
  "already_seated",
  "not_enough_players",
  "players_disconnected",
  "not_a_player",
  "stale_turn",
  "unknown_member",
  "not_disconnected_long_enough",
  "not_their_turn",
  "private_only",
  "chat_not_allowed",
  "chat_too_fast",
  "chat_invalid",
] as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

const ENGINE_ERROR_CODES = [
  "GAME_OVER",
  "INVALID_SEAT",
  "DEAD_PLAYER",
  "WRONG_PHASE",
  "NOT_YOUR_TURN",
  "ALREADY_VOTED",
  "INVALID_TARGET",
  "INELIGIBLE_CHANCELLOR",
  "ALREADY_INVESTIGATED",
  "INVALID_INDEX",
  "VETO_UNAVAILABLE",
  "INVALID_ACTION",
] as const satisfies readonly EngineErrorCode[];

export type ErrorCode = RoomErrorCode | EngineErrorCode;

const gameSnapshotSchema = z.strictObject({
  turn: z.int().positive(),
  view: playerViewSchema,
  /** Every event of this game the player may see, oldest first. */
  log: z.array(gameEventSchema),
});

export const serverMessageSchema = z.discriminatedUnion("t", [
  /** Full snapshot, sent on every (re)connection and when a game starts or resets. */
  z.strictObject({
    t: z.literal("welcome"),
    protocol: z.int().positive(),
    you: z.strictObject({ pid: z.string(), name: z.string() }),
    room: roomViewSchema,
    game: gameSnapshotSchema.nullable(),
    chat: z.array(chatMessageSchema),
    /** Server clock (ms since epoch), to turn deadlines into countdowns. */
    serverTime: z.int(),
  }),
  z.strictObject({ t: z.literal("room"), room: roomViewSchema, serverTime: z.int() }),
  /** The game moved on: the new view and the events since the last game message. */
  z.strictObject({
    t: z.literal("game"),
    turn: z.int().positive(),
    view: playerViewSchema,
    events: z.array(gameEventSchema),
  }),
  z.strictObject({ t: z.literal("chat"), message: chatMessageSchema }),
  /** The last message from this tab was refused. Nothing changed. */
  z.strictObject({
    t: z.literal("error"),
    code: z.enum([...ROOM_ERROR_CODES, ...ENGINE_ERROR_CODES]),
  }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type WelcomeMessage = Extract<ServerMessage, { t: "welcome" }>;
