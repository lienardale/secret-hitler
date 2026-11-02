"use server";

/**
 * The player menu of a room: block or report another member. Muting is a
 * choice of the browser alone (lib/room-client/mute.ts) and never comes here.
 *
 * Order in each: same origin → onboarded account (from the session, never
 * from the caller) → input checks → per-account rate limit → the room (who is
 * behind this room id; the room checks that the caller is a member) → the
 * database. Expected failures come back as `room.member.errors.*` keys, never
 * thrown; a refused report sends back what was typed (`.debug/007`).
 *
 * Only accounts block or report, and only accounts are blocked or reported:
 * guests play private rooms, where the host can remove them.
 */
import { headers } from "next/headers";
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  identityKey,
  isRoomCode,
  type ReportReason,
} from "@sh/protocol";

import { getCurrentUser, isOnboarded, type OnboardedUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { blockUser } from "@/lib/players/manage";
import { RoomsUnavailableError, reportToRoom, roomMember } from "@/lib/rooms/api";
import {
  createDbRateLimiter,
  DB_RATE_LIMITS,
  rateLimitKey,
  type RateLimitOptions,
} from "@/lib/security/db-rate-limit";
import { isSameOrigin } from "@/lib/security/origin";

export type MemberActionError =
  | "forbidden"
  | "account_required"
  | "invalid"
  | "rate_limited"
  /** The caller is not (or no longer) in this room. */
  | "not_member"
  /** No such member any more (left the room, or the account was deleted). */
  | "unknown_target"
  | "self"
  | "guest_target"
  | "too_many_blocks"
  | "no_room"
  | "unavailable";

export type BlockFromRoomResult =
  | { ok: true; /** The account was blocked before. */ already: boolean }
  | { ok: false; error: MemberActionError };

export type ReportPlayerResult =
  | { ok: true }
  | {
      ok: false;
      error: MemberActionError;
      /** What was typed, to put back in the form. */
      values: { reason: string; details: string };
    };

/** Room ids are short random strings (`pid` in packages/protocol). */
const PID = /^[A-Za-z0-9_-]{1,32}$/;

function isPid(value: unknown): value is string {
  return typeof value === "string" && PID.test(value);
}

function isCode(value: unknown): value is string {
  return typeof value === "string" && isRoomCode(value);
}

function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}

/** The onboarded account sending a same-origin request, or the error to return. */
async function caller(): Promise<{ user: OnboardedUser } | { error: MemberActionError }> {
  if (!isSameOrigin(await headers())) return { error: "forbidden" };
  const user = await getCurrentUser();
  if (!isOnboarded(user)) return { error: "account_required" };
  return { user };
}

async function allowed(scope: string, userId: string, options: RateLimitOptions) {
  const verdict = await createDbRateLimiter(prisma).consume(rateLimitKey(scope, userId), options);
  return verdict.ok;
}

/**
 * Blocks the account behind room id `pid` in room `code`. The page then
 * reconnects, so the next ticket carries the block (the room hides that
 * player's messages; quick match keeps the two apart).
 */
export async function blockFromRoomAction(code: string, pid: string): Promise<BlockFromRoomResult> {
  const who = await caller();
  if ("error" in who) return { ok: false, error: who.error };
  const { user } = who;
  if (!isCode(code) || !isPid(pid)) return { ok: false, error: "invalid" };
  if (!(await allowed("room-block", user.id, DB_RATE_LIMITS.roomBlockPerUser))) {
    return { ok: false, error: "rate_limited" };
  }

  let found: Awaited<ReturnType<typeof roomMember>>;
  try {
    found = await roomMember(code, { requester: identityKey("user", user.id), pid });
  } catch (error) {
    if (error instanceof RoomsUnavailableError) return { ok: false, error: "unavailable" };
    throw error;
  }
  if (!found.ok) return { ok: false, error: found.error };
  if (found.member.kind !== "user") return { ok: false, error: "guest_target" };

  const result = await blockUser(prisma, user.id, found.member.sub);
  if (result.ok) return { ok: true, already: result.already };
  switch (result.error) {
    case "blockSelf":
      return { ok: false, error: "self" };
    case "tooManyBlocks":
      return { ok: false, error: "too_many_blocks" };
    case "playerNotFound":
      return { ok: false, error: "unknown_target" };
  }
}

/**
 * Reports room member `pid` to the moderators. The room checks both members,
 * builds the evidence (latest chat, public game log, members) and delivers it
 * from its outbox; `reportId` makes that delivery idempotent.
 */
export async function reportPlayerAction(
  code: string,
  pid: string,
  reason: string,
  details: string,
): Promise<ReportPlayerResult> {
  const typedDetails = typeof details === "string" ? details.slice(0, REPORT_DETAILS_MAX * 2) : "";
  const values = {
    reason: typeof reason === "string" ? reason.slice(0, 20) : "",
    details: typedDetails,
  };
  const refuse = (error: MemberActionError): ReportPlayerResult => ({ ok: false, error, values });

  const who = await caller();
  if ("error" in who) return refuse(who.error);
  const { user } = who;
  const text = typedDetails.trim();
  if (!isCode(code) || !isPid(pid) || !isReportReason(reason)) return refuse("invalid");
  if (text.length > REPORT_DETAILS_MAX) return refuse("invalid");
  if (!(await allowed("report", user.id, DB_RATE_LIMITS.reportPerUser))) {
    return refuse("rate_limited");
  }

  let sent: Awaited<ReturnType<typeof reportToRoom>>;
  try {
    sent = await reportToRoom(code, {
      reportId: crypto.randomUUID(),
      reporter: identityKey("user", user.id),
      target: pid,
      reason,
      details: text,
    });
  } catch (error) {
    if (error instanceof RoomsUnavailableError) return refuse("unavailable");
    throw error;
  }
  return sent.ok ? { ok: true } : refuse(sent.error);
}
