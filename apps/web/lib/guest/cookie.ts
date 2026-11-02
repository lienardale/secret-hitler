/**
 * Guest identity: a signed cookie holding a random guest id and a display
 * name, valid 30 days. Guests can create and join private rooms; public rooms
 * need an account (M4).
 *
 * The cookie is an HS256 JWT signed with GUEST_SECRET, so a guest cannot pick
 * someone else's id (which would let them take that person's seat).
 */
import { SignJWT, jwtVerify } from "jose";

import { checkDisplayName, normalizeDisplayName } from "@sh/protocol";

export const GUEST_COOKIE = "sh_guest";
export const GUEST_TTL_SECONDS = 30 * 24 * 60 * 60;
const ISSUER = "sh-web-guest";

export interface Guest {
  /** Random id, the `sub` of this guest's room tickets. */
  gid: string;
  name: string;
}

const encoder = new TextEncoder();

/** 16 random bytes, base64url: 22 characters matching the protocol's subject shape. */
export function newGuestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function signGuest(guest: Guest, secret: string, now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  return new SignJWT({ name: guest.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setSubject(guest.gid)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + GUEST_TTL_SECONDS)
    .sign(encoder.encode(secret));
}

/** The guest in a cookie value, or null if it is missing, forged, expired or malformed. */
export async function verifyGuest(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<Guest | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      currentDate: new Date(now),
    });
    const gid = payload.sub;
    const name = payload.name;
    if (typeof gid !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(gid)) return null;
    if (typeof name !== "string" || checkDisplayName(name) !== null) return null;
    return { gid, name: normalizeDisplayName(name) };
  } catch {
    return null;
  }
}
