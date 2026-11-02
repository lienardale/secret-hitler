"use server";

/**
 * Profile actions: rename, block (by name or from the game history), unblock,
 * delete the account. Thin: the rules live in lib/players/manage.ts.
 *
 * Order in each: same origin → onboarded account (from the session, never
 * from the form) → input checks → the data function → `refresh()` so the page
 * shows the change. Expected failures come back as `profile.errors.*` keys,
 * never thrown.
 */
import { refresh } from "next/cache";
import { headers } from "next/headers";

import { signOut } from "@/auth";
import { getCurrentUser, isOnboarded, type OnboardedUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { isLocale, routing } from "@/lib/i18n/routing";
import {
  blockByName,
  blockUser,
  deleteAccount,
  renameAccount,
  unblock,
} from "@/lib/players/manage";
import { createDbRateLimiter, DB_RATE_LIMITS, rateLimitKey } from "@/lib/security/db-rate-limit";
import { isSameOrigin } from "@/lib/security/origin";

export type ProfileError =
  | "forbidden"
  | "signInRequired"
  | "rateLimited"
  | "name_length"
  | "name_characters"
  | "name_reserved"
  | "nameTaken"
  | "sameName"
  | "renameTooSoon"
  | "accountNotFound"
  | "playerNotFound"
  | "blockSelf"
  | "tooManyBlocks"
  | "wrongPassword"
  | "wrongName";

export type ProfileNotice = "renamed" | "blocked" | "alreadyBlocked" | "unblocked";

export type ProfileState =
  | null
  | { ok: true; notice: ProfileNotice; name?: string }
  | {
      ok: false;
      error: ProfileError;
      /** `renameTooSoon`: when the next rename is allowed (epoch ms). */
      nextAt?: number;
      /** `rateLimited`. */
      retryAfterSec?: number;
    };

/** Longest input read from a form (names are 20 characters, bcrypt reads 72 bytes). */
const MAX_INPUT = 200;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The onboarded account sending a same-origin request, or the error to return. */
async function caller(): Promise<{ user: OnboardedUser } | { error: ProfileState }> {
  if (!isSameOrigin(await headers())) return { error: { ok: false, error: "forbidden" } };
  const user = await getCurrentUser();
  if (!isOnboarded(user)) return { error: { ok: false, error: "signInRequired" } };
  return { user };
}

async function limited(scope: string, userId: string, options: { max: number; windowMs: number }) {
  const verdict = await createDbRateLimiter(prisma).consume(rateLimitKey(scope, userId), options);
  if (verdict.ok) return null;
  return {
    ok: false,
    error: "rateLimited",
    retryAfterSec: Math.ceil(verdict.retryAfterMs / 1000),
  } as const satisfies ProfileState;
}

export async function renameAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const who = await caller();
  if ("error" in who) return who.error;
  const raw = text(formData, "displayName");
  if (raw.length > MAX_INPUT) return { ok: false, error: "name_length" };
  const result = await renameAccount(prisma, who.user.id, raw);
  if (!result.ok) {
    return result.error === "renameTooSoon"
      ? { ok: false, error: result.error, nextAt: result.nextAt.getTime() }
      : { ok: false, error: result.error };
  }
  refresh();
  return { ok: true, notice: "renamed", name: result.name };
}

export async function blockByNameAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const who = await caller();
  if ("error" in who) return who.error;
  const raw = text(formData, "name");
  if (raw.trim() === "" || raw.length > MAX_INPUT) return { ok: false, error: "playerNotFound" };
  const refused = await limited("block-lookup", who.user.id, DB_RATE_LIMITS.blockLookupPerUser);
  if (refused) return refused;
  const result = await blockByName(prisma, who.user.id, raw);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, notice: result.already ? "alreadyBlocked" : "blocked", name: result.name };
}

/** The "Block" buttons of the game history (the target's account id, shown only to its owner). */
export async function blockPlayerAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const who = await caller();
  if ("error" in who) return who.error;
  const result = await blockUser(prisma, who.user.id, text(formData, "userId"));
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, notice: result.already ? "alreadyBlocked" : "blocked", name: result.name };
}

export async function unblockAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const who = await caller();
  if ("error" in who) return who.error;
  await unblock(prisma, who.user.id, text(formData, "userId"));
  // Already gone counts as done: the page shows the current list either way.
  refresh();
  return { ok: true, notice: "unblocked" };
}

/**
 * Deletes the account, then signs out (Auth.js deletes the session cookie and
 * redirects home). Password guesses are limited like a sign-in.
 */
export async function deleteAccountAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const who = await caller();
  if ("error" in who) return who.error;
  const localeValue = formData.get("locale");
  const locale = isLocale(localeValue) ? localeValue : routing.defaultLocale;
  const password = text(formData, "password");
  const displayName = text(formData, "confirmName");
  if (password.length > MAX_INPUT || displayName.length > MAX_INPUT) {
    return { ok: false, error: who.user.hasPassword ? "wrongPassword" : "wrongName" };
  }
  const refused = await limited("delete-account", who.user.id, DB_RATE_LIMITS.deleteAccountPerUser);
  if (refused) return refused;

  const result = await deleteAccount(prisma, who.user.id, { password, displayName });
  if (!result.ok) return { ok: false, error: result.error };
  // Throws NEXT_REDIRECT: outside any try.
  await signOut({ redirectTo: `/${locale}` });
  return null;
}
