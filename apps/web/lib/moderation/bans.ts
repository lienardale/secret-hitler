/**
 * Reading bans. A ban is active while it is not revoked and has no end date
 * (permanent) or an end date in the future. Bans apply to accounts only:
 * guests play private rooms, where the host can kick.
 */
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

export interface ActiveBan {
  id: string;
  reason: string;
  createdAt: Date;
  /** null: permanent. */
  expiresAt: Date | null;
}

/** The `where` clause of a user's active bans. */
export function activeBanWhere(userId: string, now: Date = new Date()): Prisma.BanWhereInput {
  return {
    userId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/**
 * The account's active ban, or null. With several, the one that lasts longest
 * (a permanent one first).
 */
export async function activeBan(
  db: Pick<PrismaClient, "ban">,
  userId: string,
  now: Date = new Date(),
): Promise<ActiveBan | null> {
  const bans = await db.ban.findMany({
    where: activeBanWhere(userId, now),
    select: { id: true, reason: true, createdAt: true, expiresAt: true },
  });
  if (bans.length === 0) return null;
  return bans.sort((a, b) => {
    if (a.expiresAt === null) return -1;
    if (b.expiresAt === null) return 1;
    return b.expiresAt.getTime() - a.expiresAt.getTime();
  })[0] as ActiveBan;
}
