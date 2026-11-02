/**
 * Moderation calls between the website and the rooms Worker (M5).
 *
 * website → rooms (HMAC with WEB_TO_ROOMS_SECRET):
 * - `POST /internal/rooms/:code/report`: a player reports another member of
 *   the room. The room checks both, builds the evidence itself and queues a
 *   `ReportPayload` in its outbox. 202 `{ ok: true }`; 404 `{ error: "no_room" }`;
 *   422 `{ error: RoomReportError }`.
 * - `POST /internal/rooms/:code/member`: who is behind a room id (pid), for
 *   "block this player" in the room. Only answered for a requester who is a
 *   member of that room. 200 `RoomMember`; 404 `{ error: "no_room" | "unknown_target" }`;
 *   422 `{ error: "not_member" }`.
 * - `POST /internal/moderation`: apply a ban or a forced rename to the live
 *   rooms of an account: the listed rooms plus the public rooms the lobby knows
 *   it is in. 200 `ModerationResponse`.
 *
 * rooms → website (HMAC with ROOMS_TO_WEB_SECRET), from the room's outbox:
 * - `POST /api/internal/reports` with a `ReportPayload`, idempotent on `reportId`.
 */
import { z } from "zod";

import {
  IDENTITY_KINDS,
  LANGS,
  REPORT_DETAILS_MAX,
  REPORT_EVIDENCE_CHAT,
  REPORT_REASONS,
  VISIBILITIES,
} from "./constants";
import { chatMessageSchema } from "./chat";
import { gameEventSchema } from "./player-view";
import { displayNameSchema, identityKeySchema, roomCodeSchema, subjectSchema } from "./primitives";

/** A room-scoped member id (`pid`), as clients see it. */
const pidSchema = z.string().min(1).max(32);

// ── website → rooms ──────────────────────────────────────────────────────

export const roomReportRequestSchema = z.strictObject({
  /** Chosen by the website: the report's id from end to end (idempotency key). */
  reportId: z.uuid(),
  /** Identity key of the reporter (`u:<account id>`); must be a member of the room. */
  reporter: identityKeySchema,
  /** Room id of the reported member. */
  target: pidSchema,
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(REPORT_DETAILS_MAX),
});
export type RoomReportRequest = z.infer<typeof roomReportRequestSchema>;

export const ROOM_REPORT_ERRORS = [
  /** The reporter is not (or no longer) in this room. */
  "not_member",
  /** No member with this pid. */
  "unknown_target",
  /** Reporting oneself. */
  "self",
  /** Guests cannot be reported (bans apply to accounts only; the host can kick them). */
  "guest_target",
] as const;
export type RoomReportError = (typeof ROOM_REPORT_ERRORS)[number];

export const roomMemberRequestSchema = z.strictObject({
  requester: identityKeySchema,
  pid: pidSchema,
});
export type RoomMemberRequest = z.infer<typeof roomMemberRequestSchema>;

export const roomMemberSchema = z.strictObject({
  kind: z.enum(IDENTITY_KINDS),
  sub: subjectSchema,
  name: z.string().max(40),
});
export type RoomMember = z.infer<typeof roomMemberSchema>;

export const moderationActionSchema = z.discriminatedUnion("kind", [
  /** Close the account's sockets (CLOSE.banned) and refuse it in these rooms from now on. */
  z.strictObject({ kind: z.literal("ban") }),
  /** Show the account under a new name from now on (system message `playerRenamed`). */
  z.strictObject({ kind: z.literal("rename"), name: displayNameSchema }),
]);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

export const moderationRequestSchema = z.strictObject({
  /** Accounts only (`u:…`): bans do not apply to guests. */
  identity: identityKeySchema.refine((key) => key.startsWith("u:"), {
    message: "accounts only",
  }),
  /** Rooms the account recently got a ticket for (the website keeps the list). */
  rooms: z.array(roomCodeSchema).max(100),
  action: moderationActionSchema,
});
export type ModerationRequest = z.infer<typeof moderationRequestSchema>;

export const moderationResponseSchema = z.strictObject({
  /** Rooms where the account was a member and the action was applied. */
  applied: z.array(roomCodeSchema),
});
export type ModerationResponse = z.infer<typeof moderationResponseSchema>;

// ── rooms → website ──────────────────────────────────────────────────────

const reportPartySchema = z.strictObject({
  pid: pidSchema,
  kind: z.enum(IDENTITY_KINDS),
  sub: subjectSchema,
  /** Name in the room (may carry a " 2" suffix). */
  name: z.string().max(40),
});
export type ReportParty = z.infer<typeof reportPartySchema>;

export const reportEvidenceSchema = z.strictObject({
  status: z.enum(["lobby", "playing", "ended"]),
  /** The current (or last) game of the room, if any. */
  game: z.strictObject({ id: z.uuid(), number: z.int().positive() }).nullable(),
  /** Everyone in the room when the report was made (players, then spectators). */
  members: z
    .array(
      z.strictObject({
        pid: pidSchema,
        kind: z.enum(IDENTITY_KINDS),
        sub: subjectSchema,
        name: z.string().max(40),
        /** Seat in the current game, or null (lobby, spectator). */
        seat: z.int().min(0).max(9).nullable(),
        host: z.boolean(),
        connected: z.boolean(),
      }),
    )
    .max(60),
  /** The latest chat messages, oldest first, unfiltered (blocks do not apply). */
  chat: z.array(chatMessageSchema).max(REPORT_EVIDENCE_CHAT),
  /** The current game's events as a spectator sees them (no hidden information). */
  events: z.array(gameEventSchema).max(1000),
});
export type ReportEvidence = z.infer<typeof reportEvidenceSchema>;

export const reportPayloadSchema = z.strictObject({
  reportId: z.uuid(),
  room: roomCodeSchema,
  visibility: z.enum(VISIBILITIES),
  lang: z.enum(LANGS),
  /** When the room took the snapshot (ms since epoch). */
  createdAt: z.int(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(REPORT_DETAILS_MAX),
  reporter: reportPartySchema,
  target: reportPartySchema,
  evidence: reportEvidenceSchema,
});
export type ReportPayload = z.infer<typeof reportPayloadSchema>;
