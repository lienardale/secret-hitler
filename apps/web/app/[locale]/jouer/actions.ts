"use server";

/**
 * Quick match: put a signed-in player in the fullest waiting public room of
 * their language, or open one (docs/plan.md § Lobby DO).
 *
 * Order: same origin → onboarded account → verified e-mail (when required) →
 * abandon cooldown (2 public abandons in 24 h → 15 min) → rate limit → the
 * Lobby's pick, avoiding players blocked in EITHER direction → create a room
 * when it answers null → redirect. Expected failures are returned as
 * `lobby.errors.*` keys.
 */
import { headers } from "next/headers";
import { identityKey } from "@sh/protocol";

import { getCurrentUser, isOnboarded } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { quickMatchCooldownUntil } from "@/lib/games/cooldown";
import { redirect } from "@/lib/i18n/navigation";
import { isLocale } from "@/lib/i18n/routing";
import { avoidKeys } from "@/lib/players/blocks";
import { RoomsUnavailableError, createRoom, quickMatch } from "@/lib/rooms/api";
import { createDbRateLimiter, DB_RATE_LIMITS, rateLimitKey } from "@/lib/security/db-rate-limit";
import { isSameOrigin } from "@/lib/security/origin";

export type QuickMatchError =
  | "sign_in_required"
  | "verify_required"
  | "cooldown"
  | "rate_limited"
  | "rooms_unavailable"
  | "forbidden";

export type QuickMatchState = null | { ok: false; error: QuickMatchError; until?: number };

export async function quickMatchAction(
  _prev: QuickMatchState,
  formData: FormData,
): Promise<QuickMatchState> {
  if (!isSameOrigin(await headers())) return { ok: false, error: "forbidden" };
  const locale = formData.get("locale");
  if (!isLocale(locale)) return { ok: false, error: "forbidden" };

  const user = await getCurrentUser();
  if (!isOnboarded(user)) return { ok: false, error: "sign_in_required" };
  if (getEnv().REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    return { ok: false, error: "verify_required" };
  }
  const cooldown = await quickMatchCooldownUntil(user.id);
  if (cooldown) return { ok: false, error: "cooldown", until: cooldown.getTime() };
  const verdict = await createDbRateLimiter(prisma).consume(
    rateLimitKey("quick-match", user.id),
    DB_RATE_LIMITS.quickMatchPerUser,
  );
  if (!verdict.ok) return { ok: false, error: "rate_limited" };

  const identity = identityKey("user", user.id);
  let code: string | null;
  try {
    code = await quickMatch({ identity, lang: locale, blocks: await avoidKeys(prisma, user.id) });
    code ??= await createRoom({
      visibility: "public",
      lang: locale,
      host: { kind: "user", sub: user.id, name: user.displayName },
    });
  } catch (error) {
    if (error instanceof RoomsUnavailableError) return { ok: false, error: "rooms_unavailable" };
    throw error;
  }
  // Outside the try: redirect() throws to navigate.
  redirect({ href: { pathname: "/salle/[code]", params: { code } }, locale });
  return null;
}
