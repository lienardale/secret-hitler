/**
 * Messages a browser sends to its room over the WebSocket. The ticket in the
 * connection URL already identifies the player, so no message carries an
 * identity.
 */
import { z } from "zod";

import { actionSchema } from "./player-view";
import { CHAT_MAX_LENGTH } from "./chat";
import { TIMER_PRESETS } from "./room-view";

/** Larger messages are rejected before parsing. */
export const MAX_CLIENT_MESSAGE_BYTES = 2048;

export const clientMessageSchema = z.discriminatedUnion("t", [
  /** Lobby: take a free seat. Members are seated automatically when they join. */
  z.strictObject({ t: z.literal("sit") }),
  /** Lobby: give up the seat and watch instead. */
  z.strictObject({ t: z.literal("stand") }),
  /** Host, lobby: change settings. */
  z.strictObject({
    t: z.literal("settings"),
    timers: z.enum(TIMER_PRESETS).optional(),
    minPlayers: z.int().min(5).max(10).optional(),
  }),
  /** Host, private room: start the game (5 to 10 seated players, all connected). */
  z.strictObject({ t: z.literal("start") }),
  /** Host: remove a member for the rest of the room's life. */
  z.strictObject({ t: z.literal("kick"), pid: z.string().max(32) }),
  /** A game action, tagged with the turn it answers so a late click never lands on a new decision. */
  z.strictObject({ t: z.literal("action"), turn: z.int().positive(), action: actionSchema }),
  z.strictObject({ t: z.literal("chat"), text: z.string().max(CHAT_MAX_LENGTH * 4) }),
  /** Host, private room: play the default action for a player disconnected for 60 s or more. */
  z.strictObject({ t: z.literal("forceTurn"), pid: z.string().max(32) }),
  /** Host, private room: stop the game without a winner. */
  z.strictObject({ t: z.literal("endGame") }),
  /** Host, after a game: back to the lobby with the same code. */
  z.strictObject({ t: z.literal("rematch") }),
  /** Ask for a full snapshot (the client noticed a gap). */
  z.strictObject({ t: z.literal("sync") }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/**
 * Keep-alive: the client sends this exact text every 30 s and the room
 * answers `KEEPALIVE_PONG` without waking up (Durable Object auto-response).
 */
export const KEEPALIVE_PING = "ping";
export const KEEPALIVE_PONG = "pong";
