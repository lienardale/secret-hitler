/**
 * Blocks as the rooms Worker sees them: identity keys (`u:<user id>`).
 *
 * - `blockedKeys`: who this account blocked. Carried in its room tickets: the
 *   room hides those players' chat from it.
 * - `avoidKeys`: both directions (blocked by me, or blocking me). Sent with
 *   quick match, so two players who do not want to meet are never matched
 *   whichever of them asked (docs/protocol.md, closed gap).
 */
import { identityKey } from "@sh/protocol";

import type { PrismaClient } from "@/lib/generated/prisma/client";

export const MAX_BLOCK_KEYS = 500;

type BlockStore = Pick<PrismaClient, "block">;

export async function blockedKeys(db: BlockStore, userId: string): Promise<string[]> {
  const rows = await db.block.findMany({
    where: { blockerId: userId },
    select: { blockedId: true },
    orderBy: { createdAt: "desc" },
    take: MAX_BLOCK_KEYS,
  });
  return rows.map((row) => identityKey("user", row.blockedId));
}

export async function avoidKeys(db: BlockStore, userId: string): Promise<string[]> {
  const rows = await db.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
    orderBy: { createdAt: "desc" },
    take: MAX_BLOCK_KEYS * 2,
  });
  const keys = new Set<string>();
  for (const row of rows) {
    const other = row.blockerId === userId ? row.blockedId : row.blockerId;
    keys.add(identityKey("user", other));
  }
  return [...keys].slice(0, MAX_BLOCK_KEYS);
}
