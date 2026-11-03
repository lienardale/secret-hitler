/**
 * The daily retention cleanup on real Postgres: each kind of data goes once its
 * period has passed and stays before (lib/retention/cleanup.ts).
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { ingestGameResult } from "@/lib/games/ingest";
import { RETENTION_MS, runRetentionCleanup } from "@/lib/retention/cleanup";

import { createAccount, gameResult } from "../_fixtures/game-result";

const NOW = new Date(Date.parse("2027-06-01T03:17:00Z"));
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

function key(): string {
  return randomUUID().replaceAll("-", "").padEnd(64, "0");
}

async function report(status: "open" | "dismissed" | "actioned", resolvedAt: Date | null) {
  const id = randomUUID();
  await prisma.report.create({
    data: {
      id,
      room: "BCDFG",
      reporterName: "Ada",
      targetName: "Basile",
      reason: "spam",
      evidence: { chat: [] },
      status,
      createdAt: ago(800 * DAY),
      resolvedAt,
    },
  });
  return id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "RateLimit", "EmailToken", "RoomVisit", "Report", "ModerationAction", "GameLog", "GamePlayer", "Game", "BarredEmail" CASCADE',
  );
});

describe("runRetentionCleanup", () => {
  it("keeps every period agreed for the privacy page", () => {
    expect(RETENTION_MS).toEqual({
      rateLimit: DAY,
      roomVisit: 7 * DAY,
      dismissedReport: 183 * DAY,
      actionedReport: 365 * DAY,
      moderationAction: 730 * DAY,
      gameLog: 365 * DAY,
      guestName: 365 * DAY,
    });
  });

  it("deletes abuse counters a day after their window, but never during a lock", async () => {
    const old = key();
    const locked = key();
    const fresh = key();
    await prisma.rateLimit.createMany({
      data: [
        { key: old, count: 3, windowStart: ago(2 * DAY) },
        { key: locked, count: 9, windowStart: ago(2 * DAY), lockedUntil: later(DAY) },
        { key: fresh, count: 1, windowStart: ago(DAY / 2) },
      ],
    });
    const counts = await runRetentionCleanup(prisma, NOW);
    expect(counts.rateLimits).toBe(1);
    const left = await prisma.rateLimit.findMany({ select: { key: true } });
    expect(left.map((row) => row.key).sort()).toEqual([locked, fresh].sort());
  });

  it("deletes expired e-mail links and room visits older than a week", async () => {
    const userId = await createAccount("Retention links");
    await prisma.emailToken.createMany({
      data: [
        { userId, purpose: "VERIFY_EMAIL", tokenHash: key(), expiresAt: ago(1) },
        { userId, purpose: "VERIFY_EMAIL", tokenHash: key(), expiresAt: later(DAY) },
      ],
    });
    await prisma.roomVisit.createMany({
      data: [
        { userId, room: "BCDFG", lastAt: ago(8 * DAY) },
        { userId, room: "HJKLM", lastAt: ago(6 * DAY) },
      ],
    });
    const counts = await runRetentionCleanup(prisma, NOW);
    expect(counts).toMatchObject({ emailTokens: 1, roomVisits: 1 });
    expect(await prisma.emailToken.count()).toBe(1);
    expect((await prisma.roomVisit.findMany()).map((v) => v.room)).toEqual(["HJKLM"]);
  });

  it("deletes handled reports after 6 months (dismissed) or 12 (actioned), never open ones", async () => {
    const dismissedOld = await report("dismissed", ago(184 * DAY));
    const dismissedFresh = await report("dismissed", ago(100 * DAY));
    const actionedOld = await report("actioned", ago(366 * DAY));
    const actionedFresh = await report("actioned", ago(200 * DAY));
    const open = await report("open", null);
    await prisma.moderationAction.create({
      data: { kind: "dismiss", reportId: actionedOld, createdAt: ago(366 * DAY) },
    });

    const counts = await runRetentionCleanup(prisma, NOW);
    expect(counts.reports).toBe(2);
    const left = (await prisma.report.findMany({ select: { id: true } })).map((r) => r.id);
    expect(left.sort()).toEqual([dismissedFresh, actionedFresh, open].sort());
    expect([dismissedOld, actionedOld].some((id) => left.includes(id))).toBe(false);
    // The log entry outlives its report (reportId set to null), until its own 2 years.
    expect(await prisma.moderationAction.findFirst()).toMatchObject({ reportId: null });
  });

  it("deletes moderation log entries after 2 years", async () => {
    await prisma.moderationAction.createMany({
      data: [
        { kind: "dismiss", createdAt: ago(731 * DAY) },
        { kind: "dismiss", createdAt: ago(729 * DAY) },
      ],
    });
    expect((await runRetentionCleanup(prisma, NOW)).moderationActions).toBe(1);
    expect(await prisma.moderationAction.count()).toBe(1);
  });

  it("deletes replay logs and forgets guest names 12 months after a game", async () => {
    const userId = await createAccount("Retention player");
    const old = gameResult({ players: 5, users: { 0: userId }, endedAt: ago(366 * DAY).getTime() });
    const fresh = gameResult({
      players: 5,
      users: { 0: userId },
      endedAt: ago(300 * DAY).getTime(),
    });
    await ingestGameResult(old);
    await ingestGameResult(fresh);

    const counts = await runRetentionCleanup(prisma, NOW);
    expect(counts.gameLogs).toBe(1);
    expect(counts.guestNames).toBe(4);
    expect(await prisma.gameLog.findUnique({ where: { gameId: old.gameId } })).toBeNull();
    expect(await prisma.gameLog.findUnique({ where: { gameId: fresh.gameId } })).not.toBeNull();

    const oldPlayers = await prisma.gamePlayer.findMany({ where: { gameId: old.gameId } });
    expect(oldPlayers).toHaveLength(5);
    for (const player of oldPlayers) {
      // The account keeps its name (it has one while it exists); guests lose theirs.
      if (player.kind === "guest") expect(player.name).toBeNull();
      else expect(player.userId).toBe(userId);
    }
    const freshGuests = await prisma.gamePlayer.findMany({
      where: { gameId: fresh.gameId, kind: "guest" },
    });
    expect(freshGuests.every((player) => player.name !== null)).toBe(true);
  });

  it("deletes barred e-mail fingerprints once the suspension ended, never permanent ones", async () => {
    await prisma.barredEmail.createMany({
      data: [
        { fingerprint: key(), until: ago(1) },
        { fingerprint: key(), until: later(DAY) },
        { fingerprint: key(), until: null },
      ],
    });
    expect((await runRetentionCleanup(prisma, NOW)).barredEmails).toBe(1);
    expect(await prisma.barredEmail.count()).toBe(2);
  });

  it("is idempotent: a second run deletes nothing", async () => {
    await prisma.rateLimit.create({ data: { key: key(), count: 1, windowStart: ago(2 * DAY) } });
    await runRetentionCleanup(prisma, NOW);
    expect(Object.values(await runRetentionCleanup(prisma, NOW)).every((n) => n === 0)).toBe(true);
  });
});
