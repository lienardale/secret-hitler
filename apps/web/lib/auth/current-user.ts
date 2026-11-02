/**
 * The signed-in account, as every server page, action and route handler reads it.
 *
 * Decodes the session cookie (lib/auth/session-token.ts), then loads the row:
 * a deleted account or a bumped `sessionVersion` reads as signed out. One
 * indexed query per request (memoised with React's `cache`), and the cookie is
 * never written here, so a background request can never undo a sign-out.
 *
 * `onboarded`: the account has a display name and confirmed being 15 or older.
 * Until then it can only reach the onboarding page (`/bienvenue`).
 */
import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { prisma } from "@/lib/db/prisma";
import { redirect } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";

import { decodeSessionToken, presentSessionCookie } from "./session-token";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  role: "USER" | "MODERATOR" | "ADMIN";
  locale: Locale;
  emailVerified: boolean;
  hasPassword: boolean;
  /** Display name set and age confirmed. */
  onboarded: boolean;
  displayNameChangedAt: Date | null;
}

export interface OnboardedUser extends CurrentUser {
  displayName: string;
  onboarded: true;
}

async function loadCurrentUser(): Promise<CurrentUser | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const jar = await cookies();
  const cookieName = presentSessionCookie(jar.getAll().map((cookie) => cookie.name));
  if (!cookieName) return null;
  const token = jar.get(cookieName)?.value;
  if (!token) return null;
  const claims = await decodeSessionToken(token, { secret, cookieName });
  if (!claims) return null;

  const row = await prisma.user.findUnique({
    where: { id: claims.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      locale: true,
      emailVerified: true,
      passwordHash: true,
      ageConfirmedAt: true,
      sessionVersion: true,
      displayNameChangedAt: true,
    },
  });
  if (!row || row.sessionVersion !== claims.sessionVersion) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    locale: row.locale,
    emailVerified: row.emailVerified !== null,
    hasPassword: row.passwordHash !== null,
    onboarded: row.displayName !== null && row.ageConfirmedAt !== null,
    displayNameChangedAt: row.displayNameChangedAt,
  };
}

/** The signed-in account, or null. */
export const getCurrentUser = cache(loadCurrentUser);

export function isOnboarded(user: CurrentUser | null): user is OnboardedUser {
  return user !== null && user.onboarded && user.displayName !== null;
}

/**
 * For pages: the onboarded account, or a redirect (sign-in with a return
 * path, or onboarding). `returnTo` is the page's own locale-prefixed path.
 */
export async function requireOnboardedUser(
  locale: Locale,
  returnTo: string,
): Promise<OnboardedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect({ href: { pathname: "/connexion", query: { callbackUrl: returnTo } }, locale });
  }
  if (!isOnboarded(user)) {
    redirect({ href: { pathname: "/bienvenue", query: { callbackUrl: returnTo } }, locale });
  }
  return user as OnboardedUser;
}
