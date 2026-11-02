/**
 * The Auth.js session cookie, read and minted by this app (adapted from
 * velo-atelier's lib/auth/session-cookie.ts).
 *
 * The cookie is an Auth.js JWT (encrypted with AUTH_SECRET, salted with the
 * cookie name) that carries only `id` and `sv` (the account's sessionVersion).
 * Everything else about the user — display name, role, verified e-mail — is
 * read from Postgres on each request (`lib/auth/current-user.ts`), so a rename,
 * a role change or a deleted account takes effect at once, and nothing ever
 * needs to rewrite the cookie after sign-in.
 *
 * The website never calls Auth.js's `auth()` (which re-writes the cookie on
 * every read and so races sign-out from background requests, `.debug/005`); it
 * decodes the cookie here instead. Auth.js is only used to sign in and out.
 *
 * Plain Node: no `server-only`, no `next/headers`. The e2e fixtures mint
 * sessions through `mintSessionToken`, so tests and production never drift.
 */
import { decode, encode } from "next-auth/jwt";

/** Session lifetime: 30 days from sign-in (no rolling refresh). */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = "authjs.session-token";
export const SECURE_SESSION_COOKIE_NAME = "__Secure-authjs.session-token";

/** The session cookie a request carries (the secure name wins), or null. */
export function presentSessionCookie(cookieNames: Iterable<string>): string | null {
  const names = new Set(cookieNames);
  if (names.has(SECURE_SESSION_COOKIE_NAME)) return SECURE_SESSION_COOKIE_NAME;
  if (names.has(SESSION_COOKIE_NAME)) return SESSION_COOKIE_NAME;
  return null;
}

/** What a session token says: who, and which sessionVersion it was issued for. */
export interface SessionClaims {
  id: string;
  sessionVersion: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The claims of a session token, or null when it does not decrypt or is not ours. */
export async function decodeSessionToken(
  token: string,
  { secret, cookieName }: { secret: string; cookieName: string },
): Promise<SessionClaims | null> {
  try {
    const payload = await decode({ token, secret, salt: cookieName });
    const id = payload?.id ?? payload?.sub;
    if (typeof id !== "string" || !UUID.test(id)) return null;
    const sv = payload?.sv;
    return { id, sessionVersion: typeof sv === "number" ? sv : 0 };
  } catch {
    return null;
  }
}

/** A session token Auth.js accepts as its own (e2e fixtures). */
export async function mintSessionToken(
  claims: SessionClaims,
  {
    secret,
    cookieName,
    maxAge = SESSION_MAX_AGE_S,
  }: { secret: string; cookieName: string; maxAge?: number },
): Promise<string> {
  return encode({
    token: { sub: claims.id, id: claims.id, sv: claims.sessionVersion },
    secret,
    salt: cookieName,
    maxAge,
  });
}

/** Whether a `Set-Cookie` value writes the session cookie (or one of its chunks). */
export function isSessionSetCookie(setCookie: string): boolean {
  const name = setCookie.slice(0, setCookie.indexOf("=")).trim();
  return [SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME].some(
    (base) =>
      name === base || (name.startsWith(`${base}.`) && /^\d+$/.test(name.slice(base.length + 1))),
  );
}

/**
 * A response without any session `Set-Cookie`: `GET /api/auth/session` must
 * never write or delete the cookie (a late answer could undo a sign-out).
 */
export function withoutSessionWrites(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of response.headers.getSetCookie()) {
    if (!isSessionSetCookie(cookie)) headers.append("set-cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
