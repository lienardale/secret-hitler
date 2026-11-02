/**
 * Plain constants of the moderation pages, shared by the server
 * (lib/moderation/admin.ts) and the browser forms. Nothing here imports
 * Prisma or zod, so the client components can use it.
 */

/** Ban lengths a moderator picks from. */
export const BAN_DURATIONS = ["1d", "7d", "30d", "permanent"] as const;
export type BanDuration = (typeof BAN_DURATIONS)[number];

export function isBanDuration(value: unknown): value is BanDuration {
  return typeof value === "string" && (BAN_DURATIONS as readonly string[]).includes(value);
}

/** `Ban.reason` (shown to the banned player). */
export const BAN_REASON_MAX = 500;
/** `ModerationAction.note` (moderators only). */
export const NOTE_MAX = 1000;
/** Reports per page of the queue. */
export const REPORTS_PAGE_SIZE = 50;
/** Active bans listed on the bans page. */
export const BANS_LIST_MAX = 200;
