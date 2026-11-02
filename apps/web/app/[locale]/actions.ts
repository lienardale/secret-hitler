"use server";

/**
 * Home and room-gate actions: choose a guest name, create a private room,
 * join a room by code. A signed-in account plays under its display name and
 * needs no guest cookie. Expected failures are returned as message keys
 * (room.errors.*, and `banned` as common.errors.banned), never thrown; a
 * success that changes page redirects.
 *
 * Limits (database, so they hold across serverless instances): 20 new guest
 * cookies per hour per address, 10 rooms per hour per identity and per
 * address. A suspended account cannot create a room (guests are never
 * refused for a ban: bans apply to accounts only).
 */
import { headers } from "next/headers";

import {
  checkDisplayName,
  identityKey,
  normalizeDisplayName,
  normalizeRoomCode,
  type CreateRoomRequest,
  type DisplayNameProblem,
} from "@sh/protocol";

import { getCurrentUser, isOnboarded } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { newGuestId, type Guest } from "@/lib/guest/cookie";
import { readGuest, writeGuest } from "@/lib/guest/session";
import { redirect } from "@/lib/i18n/navigation";
import { isLocale } from "@/lib/i18n/routing";
import { activeBan } from "@/lib/moderation/bans";
import { RoomsUnavailableError, createRoom, roomInfo } from "@/lib/rooms/api";
import { clientIp } from "@/lib/security/client-ip";
import {
  createDbRateLimiter,
  DB_RATE_LIMITS,
  ipRateLimiter,
  rateLimitKey,
} from "@/lib/security/db-rate-limit";
import { joinLookupLimit } from "@/lib/security/limits";
import { isSameOrigin } from "@/lib/security/origin";

export type FormError =
  | `name_${DisplayNameProblem}`
  | "code_invalid"
  | "room_not_found"
  | "rate_limited"
  | "rooms_unavailable"
  | "forbidden";

export type FormState = { ok: true } | { ok: false; error: FormError } | null;

/** Room creation can also refuse a suspended account (common.errors.banned). */
export type CreateRoomError = FormError | "banned";
export type CreateRoomState = { ok: true } | { ok: false; error: CreateRoomError } | null;

async function requestHeaders(): Promise<Headers> {
  return headers();
}

/** The guest after this request: the cookie's, or a new one named from the form. */
async function guestFromForm(
  formData: FormData,
  ip: string,
): Promise<{ guest: Guest } | { error: FormError }> {
  const raw = formData.get("name");
  const existing = await readGuest();
  if (existing && (raw === null || raw === "")) return { guest: existing };

  const name = normalizeDisplayName(typeof raw === "string" ? raw : "");
  const problem = checkDisplayName(name);
  if (problem) return { error: `name_${problem}` };
  if (!existing) {
    const verdict = await ipRateLimiter(prisma, ip).consume(
      rateLimitKey("guest-cookie", ip),
      DB_RATE_LIMITS.guestCookiePerIp,
    );
    if (!verdict.ok) return { error: "rate_limited" };
  }
  const guest = { gid: existing?.gid ?? newGuestId(), name };
  await writeGuest(guest);
  return { guest };
}

export async function saveGuestNameAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const h = await requestHeaders();
  if (!isSameOrigin(h)) return { ok: false, error: "forbidden" };
  const result = await guestFromForm(formData, clientIp(h));
  return "error" in result ? { ok: false, error: result.error } : { ok: true };
}

export async function createRoomAction(
  _prev: CreateRoomState,
  formData: FormData,
): Promise<CreateRoomState> {
  const h = await requestHeaders();
  if (!isSameOrigin(h)) return { ok: false, error: "forbidden" };
  const locale = formData.get("locale");
  if (!isLocale(locale)) return { ok: false, error: "forbidden" };
  const ip = clientIp(h);
  const user = await getCurrentUser();
  let host: CreateRoomRequest["host"];
  if (isOnboarded(user)) {
    if (await activeBan(prisma, user.id)) return { ok: false, error: "banned" };
    host = { kind: "user", sub: user.id, name: user.displayName };
  } else {
    const result = await guestFromForm(formData, ip);
    if ("error" in result) return { ok: false, error: result.error };
    host = { kind: "guest", sub: result.guest.gid, name: result.guest.name };
  }
  const byIdentity = await createDbRateLimiter(prisma).consume(
    rateLimitKey("room-create", identityKey(host.kind, host.sub)),
    DB_RATE_LIMITS.roomCreationPerIdentity,
  );
  if (!byIdentity.ok) return { ok: false, error: "rate_limited" };
  const byIp = await ipRateLimiter(prisma, ip).consume(
    rateLimitKey("room-create-ip", ip),
    DB_RATE_LIMITS.roomCreationPerIp,
  );
  if (!byIp.ok) return { ok: false, error: "rate_limited" };

  let code: string;
  try {
    code = await createRoom({ visibility: "private", lang: locale, host });
  } catch (error) {
    if (error instanceof RoomsUnavailableError) return { ok: false, error: "rooms_unavailable" };
    throw error;
  }
  // Outside the try: redirect() throws to navigate.
  redirect({ href: { pathname: "/salle/[code]", params: { code } }, locale });
  return { ok: true };
}

export async function joinRoomAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const h = await requestHeaders();
  if (!isSameOrigin(h)) return { ok: false, error: "forbidden" };
  const locale = formData.get("locale");
  if (!isLocale(locale)) return { ok: false, error: "forbidden" };
  const raw = formData.get("code");
  const code = normalizeRoomCode(typeof raw === "string" ? raw : "");
  if (!code) return { ok: false, error: "code_invalid" };
  if (!joinLookupLimit.take(clientIp(h)).ok) return { ok: false, error: "rate_limited" };

  let exists: boolean;
  try {
    exists = (await roomInfo(code)) !== null;
  } catch (error) {
    if (error instanceof RoomsUnavailableError) return { ok: false, error: "rooms_unavailable" };
    throw error;
  }
  if (!exists) return { ok: false, error: "room_not_found" };
  redirect({ href: { pathname: "/salle/[code]", params: { code } }, locale });
  return { ok: true };
}
