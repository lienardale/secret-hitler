/**
 * Who may use the moderation pages (`/admin/…`): accounts with the MODERATOR
 * or ADMIN role that are not themselves banned (an ADMIN can ban a MODERATOR,
 * which also takes the admin area away from them).
 *
 * - Pages call `requireModerator`: not signed in → the sign-in page with a
 *   return path; signed in without the role → 404, so the admin area stays
 *   invisible; no display name yet → onboarding.
 * - Server actions call `moderatorForAction` after their same-origin check:
 *   it never redirects, it returns the moderator or the refusal key.
 *
 * The session is read with `getCurrentUser()` only (never Auth.js's `auth()`,
 * `.debug/005`), so a role change applies on the next request.
 */
import "server-only";

import { notFound } from "next/navigation";

import {
  getCurrentUser,
  isOnboarded,
  type CurrentUser,
  type OnboardedUser,
} from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";

import { isModeratorRole, type ModeratorRole } from "./admin";
import { activeBan } from "./bans";

export interface ModeratorUser extends OnboardedUser {
  role: ModeratorRole;
}

/** For admin pages. `returnTo` is the page's own locale-prefixed path. */
export async function requireModerator(locale: Locale, returnTo: string): Promise<ModeratorUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect({ href: { pathname: "/connexion", query: { callbackUrl: returnTo } }, locale });
  }
  const signedIn = user as CurrentUser;
  if (!isModeratorRole(signedIn.role)) notFound();
  if (!isOnboarded(signedIn)) {
    redirect({ href: { pathname: "/bienvenue", query: { callbackUrl: returnTo } }, locale });
  }
  if (await activeBan(prisma, signedIn.id)) notFound();
  return signedIn as ModeratorUser;
}

export type ModeratorRefusal = "signInRequired" | "forbidden";

/** For server actions (after the same-origin check): the moderator, or the refusal key. */
export async function moderatorForAction(): Promise<
  { ok: true; moderator: ModeratorUser } | { ok: false; error: ModeratorRefusal }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "signInRequired" };
  if (!isModeratorRole(user.role) || !isOnboarded(user)) return { ok: false, error: "forbidden" };
  if (await activeBan(prisma, user.id)) return { ok: false, error: "forbidden" };
  return { ok: true, moderator: user as ModeratorUser };
}
