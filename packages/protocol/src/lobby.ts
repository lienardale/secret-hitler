/**
 * The public lobby: the list of public rooms, pushed to viewers over a
 * WebSocket, and quick match.
 */
import { z } from "zod";

import { LANGS, TIMER_PRESETS } from "./constants";
import { identityKeySchema, roomCodeSchema } from "./primitives";

/** One public room as lobby viewers see it. */
export const lobbyEntrySchema = z.strictObject({
  code: roomCodeSchema,
  lang: z.enum(LANGS),
  status: z.enum(["lobby", "playing"]),
  players: z.int().min(0).max(10),
  maxPlayers: z.int().min(5).max(10),
  minPlayers: z.int().min(5).max(10),
  timers: z.enum(TIMER_PRESETS),
  /** When the start countdown ends (ms since epoch), or null. */
  startsAt: z.int().nullable(),
});
export type LobbyEntry = z.infer<typeof lobbyEntrySchema>;

/**
 * What a public room reports to the lobby. `members` and `excluded` (identity
 * keys) never reach viewers: quick match uses `members` to keep blocked
 * players apart, and never sends anyone to a room that `excluded` them (kicked
 * by the host). `excluded` defaults to `[]` so reports stored before it
 * existed still parse.
 */
export const lobbyRoomReportSchema = lobbyEntrySchema.extend({
  members: z.array(identityKeySchema).max(40),
  excluded: z.array(identityKeySchema).max(100).default([]),
});
export type LobbyRoomReport = z.infer<typeof lobbyRoomReportSchema>;

export const lobbyMessageSchema = z.strictObject({
  t: z.literal("lobby"),
  rooms: z.array(lobbyEntrySchema),
  serverTime: z.int(),
});
export type LobbyMessage = z.infer<typeof lobbyMessageSchema>;

export const quickMatchRequestSchema = z.strictObject({
  identity: identityKeySchema,
  lang: z.enum(LANGS),
  blocks: z.array(identityKeySchema).max(500),
});
export type QuickMatchRequest = z.infer<typeof quickMatchRequestSchema>;

/** A room to join, or null: the website then creates a new public room. */
export const quickMatchResponseSchema = z.strictObject({ code: roomCodeSchema.nullable() });
export type QuickMatchResponse = z.infer<typeof quickMatchResponseSchema>;
