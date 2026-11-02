/**
 * Payloads of signed server-to-server calls:
 * - website → rooms: create a room, read a room's public info;
 * - rooms → website: the result of a finished game (sent from the room's
 *   outbox, retried until the website acknowledges it).
 */
import { z } from "zod";

import { IDENTITY_KINDS, LANGS, VISIBILITIES } from "./constants";
import { identitySchema } from "./identity";
import { actionSchema } from "./player-view";
import { roomCodeSchema, subjectSchema } from "./primitives";
import { gameResultSchema, roomSettingsSchema } from "./room-view";

export const createRoomRequestSchema = z.strictObject({
  visibility: z.enum(VISIBILITIES),
  lang: z.enum(LANGS),
  /** The creator, who becomes host when they connect. */
  host: identitySchema,
  settings: roomSettingsSchema.partial().optional(),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const createRoomResponseSchema = z.strictObject({ code: roomCodeSchema });

export const roomInfoSchema = z.strictObject({
  code: roomCodeSchema,
  visibility: z.enum(VISIBILITIES),
  lang: z.enum(LANGS),
  status: z.enum(["lobby", "playing", "ended"]),
  players: z.int().min(0).max(10),
  spectators: z.int().nonnegative(),
});
export type RoomInfo = z.infer<typeof roomInfoSchema>;

const uint32 = z.int().min(0).max(0xffffffff);

export const gameResultPayloadSchema = z.strictObject({
  /** Unique per game; the website upserts on it, so a retried delivery is harmless. */
  gameId: z.uuid(),
  room: roomCodeSchema,
  visibility: z.enum(VISIBILITIES),
  lang: z.enum(LANGS),
  /** Game number within the room (rematches count up). */
  number: z.int().positive(),
  startedAt: z.int(),
  endedAt: z.int(),
  result: gameResultSchema,
  players: z
    .array(
      z.strictObject({
        seat: z.int().min(0).max(9),
        kind: z.enum(IDENTITY_KINDS),
        sub: subjectSchema,
        name: z.string(),
        role: z.enum(["liberal", "fascist", "hitler"]),
        alive: z.boolean(),
        /** False for everyone when the game was abandoned. */
        won: z.boolean(),
      }),
    )
    .min(5)
    .max(10),
  /** Everything needed to replay the game later. */
  log: z.strictObject({
    game: z.literal("secret-hitler"),
    stateVersion: z.int().positive(),
    seed: z.tuple([uint32, uint32, uint32, uint32]),
    moves: z.array(
      z.strictObject({
        seat: z.int().min(0).max(9),
        action: actionSchema,
        at: z.int(),
        /** Played by the room (timeout, away player, or forced by the host). */
        auto: z.boolean(),
      }),
    ),
  }),
});
export type GameResultPayload = z.infer<typeof gameResultPayloadSchema>;
