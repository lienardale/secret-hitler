"use server";

/**
 * Home and room-gate actions: choose a guest name, create a private room,
 * join a room by code. Expected failures are returned as message keys
 * (room.errors.*), never thrown; a success that changes page redirects.
 */
import { headers } from "next/headers";

import {
  checkDisplayName,
  normalizeDisplayName,
  normalizeRoomCode,
  type DisplayNameProblem,
} from "@sh/protocol";

import { newGuestId, type Guest } from "@/lib/guest/cookie";
import { readGuest, writeGuest } from "@/lib/guest/session";
import { redirect } from "@/lib/i18n/navigation";
import { isLocale } from "@/lib/i18n/routing";
import { RoomsUnavailableError, createRoom, roomInfo } from "@/lib/rooms/api";
import { clientIp } from "@/lib/security/client-ip";
import { guestCookieLimit, joinLookupLimit, roomCreationLimit } from "@/lib/security/limits";
import { isSameOrigin } from "@/lib/security/origin";

export type FormError =
  | `name_${DisplayNameProblem}`
  | "code_invalid"
  | "room_not_found"
  | "rate_limited"
  | "rooms_unavailable"
  | "forbidden";

export type FormState = { ok: true } | { ok: false; error: FormError } | null;

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
  if (!existing && !guestCookieLimit.take(ip).ok) return { error: "rate_limited" };
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

export async function createRoomAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const h = await requestHeaders();
  if (!isSameOrigin(h)) return { ok: false, error: "forbidden" };
  const locale = formData.get("locale");
  if (!isLocale(locale)) return { ok: false, error: "forbidden" };
  const ip = clientIp(h);
  const result = await guestFromForm(formData, ip);
  if ("error" in result) return { ok: false, error: result.error };
  const { guest } = result;
  if (!roomCreationLimit.take(`g:${guest.gid}`).ok || !roomCreationLimit.take(`ip:${ip}`).ok) {
    return { ok: false, error: "rate_limited" };
  }

  let code: string;
  try {
    code = await createRoom({
      visibility: "private",
      lang: locale,
      host: { kind: "guest", sub: guest.gid, name: guest.name },
    });
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
