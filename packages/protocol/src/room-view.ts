/**
 * The room around the game: who is seated, who is watching, who is host,
 * settings, countdowns and deadlines. Unlike the game view it holds no
 * secrets, so every member receives the same room view.
 */
import { z } from "zod";

import { LANGS, MAX_SPECTATORS, TIMER_PRESETS, VISIBILITIES } from "./constants";
import { roomCodeSchema } from "./primitives";

export const roomSettingsSchema = z.strictObject({
  timers: z.enum(TIMER_PRESETS),
  /** Public rooms: players needed before the start countdown begins. */
  minPlayers: z.int().min(5).max(10),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

export const gameResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("finished"),
    winner: z.enum(["liberal", "fascist"]),
    reason: z.enum(["liberalPolicies", "hitlerExecuted", "fascistPolicies", "hitlerElected"]),
  }),
  /** Ended without a winner: too many players gone (public) or stopped by the host (private). */
  z.strictObject({ kind: z.literal("abandoned") }),
]);
export type GameResult = z.infer<typeof gameResultSchema>;

const memberViewSchema = z.strictObject({
  /** Room-scoped id of the member (not their account id). */
  pid: z.string(),
  name: z.string(),
  guest: z.boolean(),
  /** At least one browser tab is connected. */
  connected: z.boolean(),
});

export const playerSlotSchema = memberViewSchema.extend({
  /** Public games: the player was away too long and is played automatically. */
  afk: z.boolean(),
});
export type PlayerSlot = z.infer<typeof playerSlotSchema>;

export const roomViewSchema = z.strictObject({
  code: roomCodeSchema,
  visibility: z.enum(VISIBILITIES),
  lang: z.enum(LANGS),
  status: z.enum(["lobby", "playing", "ended"]),
  settings: roomSettingsSchema,
  hostPid: z.string().nullable(),
  /**
   * Players. In the lobby: seated members in seating order. During and after a
   * game: index = seat number in the game.
   */
  players: z.array(playerSlotSchema).max(10),
  spectators: z.array(memberViewSchema).max(MAX_SPECTATORS + 10),
  /** Public rooms: when the game starts on its own (ms since epoch), or null. */
  startsAt: z.int().nullable(),
  game: z
    .strictObject({
      /** 1 for the first game in this room, 2 after a rematch… */
      number: z.int().positive(),
      /** Changes at every new decision; actions must carry the current turn. */
      turn: z.int().positive(),
      /** When the current decision times out (ms since epoch), or null without timers. */
      deadline: z.int().nullable(),
    })
    .nullable(),
  /** Result of the last game, once it is over. */
  result: gameResultSchema.nullable(),
});
export type RoomView = z.infer<typeof roomViewSchema>;
