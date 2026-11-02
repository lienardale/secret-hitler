/**
 * Rooms an account got a ticket for. The ticket route records each one; a ban
 * or a forced rename then reaches the account's live sockets in those rooms
 * (`moderatePlayer` in lib/rooms/api.ts). A week is plenty: an idle room
 * closes after 30 minutes and a game rarely lasts more than an hour.
 */
import type { PrismaClient } from "@/lib/generated/prisma/client";

export const VISIT_TTL_MS = 7 * 24 * 60 * 60_000;
/** At most this many rooms per moderation call (the Worker's limit). */
export const MAX_VISITED_ROOMS = 100;

type VisitStore = Pick<PrismaClient, "roomVisit">;

/** Upserts the visit and prunes this account's visits older than a week. */
export async function recordVisit(
  db: VisitStore,
  userId: string,
  room: string,
  now: Date = new Date(),
): Promise<void> {
  await db.roomVisit.upsert({
    where: { userId_room: { userId, room } },
    create: { userId, room, lastAt: now },
    update: { lastAt: now },
  });
  await db.roomVisit.deleteMany({
    where: { userId, lastAt: { lt: new Date(now.getTime() - VISIT_TTL_MS) } },
  });
}

/** Room codes the account visited within the last week, most recent first. */
export async function recentRooms(
  db: VisitStore,
  userId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db.roomVisit.findMany({
    where: { userId, lastAt: { gte: new Date(now.getTime() - VISIT_TTL_MS) } },
    orderBy: { lastAt: "desc" },
    take: MAX_VISITED_ROOMS,
    select: { room: true },
  });
  return rows.map((row) => row.room);
}
