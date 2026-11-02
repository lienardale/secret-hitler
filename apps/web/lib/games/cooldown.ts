/**
 * Quick-match cooldown (docs/plan.md § Rooms Worker, public rooms): a player
 * who abandons 2 public games within 24 hours waits 15 minutes before quick
 * match seats them again.
 *
 * An abandon is a stored `GamePlayer.left`: the room was playing for them
 * when the game ended (away past the grace period, or kicked). Private games
 * never count: friends stop and leave games as they like.
 */
import { prisma } from "@/lib/db/prisma";
import type { PrismaClient } from "@/lib/generated/prisma/client";

import { isUuid } from "./ids";

/** Abandons older than this are forgiven. */
export const ABANDON_WINDOW_MS = 24 * 60 * 60_000;
/** The abandon that starts a cooldown (the 2nd within the window). */
export const ABANDON_LIMIT = 2;
/** Counted from the end of the latest abandoned game. */
export const COOLDOWN_MS = 15 * 60_000;

export type CooldownDb = Pick<PrismaClient, "gamePlayer">;

/** When the user may quick-match again, or null if they may now. */
export async function quickMatchCooldownUntil(
  userId: string,
  now: Date = new Date(),
  db: CooldownDb = prisma,
): Promise<Date | null> {
  if (!isUuid(userId)) return null;
  const abandons = await db.gamePlayer.findMany({
    where: {
      userId,
      left: true,
      game: {
        visibility: "public",
        endedAt: { gte: new Date(now.getTime() - ABANDON_WINDOW_MS), lte: now },
      },
    },
    orderBy: { game: { endedAt: "desc" } },
    take: ABANDON_LIMIT,
    select: { game: { select: { endedAt: true } } },
  });
  const latest = abandons[0];
  if (abandons.length < ABANDON_LIMIT || !latest) return null;
  const until = new Date(latest.game.endedAt.getTime() + COOLDOWN_MS);
  return until > now ? until : null;
}
