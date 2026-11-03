/**
 * The daily retention cleanup (agreed with the operator 2026-11-02; the
 * privacy page states these periods: messages `legal.privacy.retention.*`).
 * Run by Vercel Cron through `GET /api/internal/cron/cleanup` (apps/web/vercel.json).
 *
 * - Abuse counters (`RateLimit`): 24 hours after their window started, once no lock runs.
 * - E-mail links (`EmailToken`): once expired.
 * - Rooms an account visited (`RoomVisit`): 7 days.
 * - Reports and their chat copy: 6 months after being dismissed, 12 months after
 *   an action. Open reports are never deleted.
 * - Moderation log (`ModerationAction`): 2 years.
 * - Game replay logs (`GameLog`): 12 months after the game; guest names in game
 *   history are forgotten after 12 months too (the game itself stays in
 *   players' history).
 * - Barred e-mail fingerprints (`BarredEmail`): once the suspension has ended.
 *
 * Every statement is idempotent: a missed or repeated run is harmless.
 */
import type { PrismaClient } from "@/lib/generated/prisma/client";

const DAY_MS = 86_400_000;

export const RETENTION_MS = {
  rateLimit: DAY_MS,
  roomVisit: 7 * DAY_MS,
  dismissedReport: 183 * DAY_MS,
  actionedReport: 365 * DAY_MS,
  moderationAction: 730 * DAY_MS,
  gameLog: 365 * DAY_MS,
  guestName: 365 * DAY_MS,
} as const;

export type CleanupDb = Pick<
  PrismaClient,
  | "rateLimit"
  | "emailToken"
  | "roomVisit"
  | "report"
  | "moderationAction"
  | "gameLog"
  | "gamePlayer"
  | "barredEmail"
>;

export interface CleanupCounts {
  rateLimits: number;
  emailTokens: number;
  roomVisits: number;
  reports: number;
  moderationActions: number;
  gameLogs: number;
  guestNames: number;
  barredEmails: number;
}

export async function runRetentionCleanup(
  db: CleanupDb,
  now: Date = new Date(),
): Promise<CleanupCounts> {
  const before = (ms: number) => new Date(now.getTime() - ms);

  const rateLimits = await db.rateLimit.deleteMany({
    where: {
      windowStart: { lt: before(RETENTION_MS.rateLimit) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
  });
  const emailTokens = await db.emailToken.deleteMany({ where: { expiresAt: { lt: now } } });
  const roomVisits = await db.roomVisit.deleteMany({
    where: { lastAt: { lt: before(RETENTION_MS.roomVisit) } },
  });
  const reports = await db.report.deleteMany({
    where: {
      OR: [
        { status: "dismissed", resolvedAt: { lt: before(RETENTION_MS.dismissedReport) } },
        { status: "actioned", resolvedAt: { lt: before(RETENTION_MS.actionedReport) } },
      ],
    },
  });
  const moderationActions = await db.moderationAction.deleteMany({
    where: { createdAt: { lt: before(RETENTION_MS.moderationAction) } },
  });
  const gameLogs = await db.gameLog.deleteMany({
    where: { game: { endedAt: { lt: before(RETENTION_MS.gameLog) } } },
  });
  const guestNames = await db.gamePlayer.updateMany({
    where: {
      kind: "guest",
      name: { not: null },
      game: { endedAt: { lt: before(RETENTION_MS.guestName) } },
    },
    data: { name: null },
  });
  const barredEmails = await db.barredEmail.deleteMany({
    where: { until: { not: null, lt: now } },
  });

  return {
    rateLimits: rateLimits.count,
    emailTokens: emailTokens.count,
    roomVisits: roomVisits.count,
    reports: reports.count,
    moderationActions: moderationActions.count,
    gameLogs: gameLogs.count,
    guestNames: guestNames.count,
    barredEmails: barredEmails.count,
  };
}
