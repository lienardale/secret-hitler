/**
 * Moderation from the admin pages (real Postgres): bans (durations, a second
 * ban, the report it closes, live rooms reached or not), lifting a ban, forced
 * renames, dismissals, notes, the permission rules, the queue and a report's
 * detail. Every action writes exactly one `ModerationAction` row; every
 * refusal writes none. The rooms Worker is mocked (`moderatePlayer`).
 */
import { nameKey, type ReportEvidence } from "@sh/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { REPORTS_PAGE_SIZE } from "@/components/admin/constants";
import { prisma } from "@/lib/db/prisma";
import type { UserRole } from "@/lib/generated/prisma/client";
import {
  addNote,
  banUser,
  dismissReport,
  findUserByName,
  forceRename,
  getReport,
  listActiveBans,
  listReports,
  parseEvidence,
  unbanUser,
  type Moderator,
} from "@/lib/moderation/admin";
import { activeBan } from "@/lib/moderation/bans";
import { VISIT_TTL_MS } from "@/lib/moderation/visits";
import { renameAccount } from "@/lib/players/manage";

const rooms = vi.hoisted(() => {
  class RoomsUnavailableError extends Error {
    constructor(detail: string) {
      super(`rooms Worker unavailable: ${detail}`);
      this.name = "RoomsUnavailableError";
    }
  }
  return { moderatePlayer: vi.fn(), RoomsUnavailableError };
});
vi.mock("@/lib/rooms/api", () => rooms);

const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-11-02T12:00:00Z");
const SNAPSHOT_AT = Date.parse("2026-11-02T11:58:00Z");

let counter = 0;
/** A fresh valid display name per call (the database is shared by the whole file). */
function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix} ${counter}`;
}

interface Account extends Moderator {
  name: string;
}

async function account(prefix: string, role: UserRole = "USER"): Promise<Account> {
  const name = uniqueName(prefix);
  const user = await prisma.user.create({
    data: {
      email: `${nameKey(name).replace(/[^a-z0-9]/g, "-")}-${crypto.randomUUID()}@example.test`,
      displayName: name,
      displayNameKey: nameKey(name),
      ageConfirmedAt: new Date(),
      role,
    },
    select: { id: true, role: true },
  });
  return { ...user, name };
}

function evidence(reporter: Account, target: Account): ReportEvidence {
  return {
    status: "playing",
    game: { id: crypto.randomUUID(), number: 2 },
    members: [
      {
        pid: "p1",
        kind: "user",
        sub: reporter.id,
        name: reporter.name,
        seat: 0,
        host: true,
        connected: true,
      },
      {
        pid: "p2",
        kind: "user",
        sub: target.id,
        name: target.name,
        seat: 1,
        host: false,
        connected: true,
      },
      {
        pid: "p3",
        kind: "guest",
        sub: "guest-3",
        name: "Guest 3",
        seat: null,
        host: false,
        connected: false,
      },
    ],
    chat: [
      {
        kind: "system",
        id: 0,
        at: SNAPSHOT_AT - 60_000,
        key: "playerJoined",
        params: { name: target.name },
      },
      {
        kind: "player",
        id: 1,
        at: SNAPSHOT_AT - 30_000,
        pid: "p2",
        name: target.name,
        text: "rude",
      },
      {
        kind: "player",
        id: 2,
        at: SNAPSHOT_AT - 10_000,
        pid: "p1",
        name: reporter.name,
        text: "stop",
      },
    ],
    events: [],
  };
}

async function openReport(
  reporter: Account,
  target: Account,
  extra: { receivedAt?: Date; evidence?: unknown; status?: "open" | "dismissed" | "actioned" } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await prisma.report.create({
    data: {
      id,
      room: "BCDFG",
      reporterId: reporter.id,
      reporterName: reporter.name,
      targetId: target.id,
      targetName: target.name,
      reason: "harassment",
      details: "Insults all game long",
      evidence: (extra.evidence ?? evidence(reporter, target)) as object,
      status: extra.status ?? "open",
      createdAt: new Date(SNAPSHOT_AT),
      receivedAt: extra.receivedAt ?? new Date(),
    },
  });
  return id;
}

/** Runs `action` and checks it wrote exactly `rows` moderation rows. */
async function logging<T>(rows: number, action: () => Promise<T>): Promise<T> {
  const before = await prisma.moderationAction.count();
  const result = await action();
  expect(await prisma.moderationAction.count()).toBe(before + rows);
  return result;
}

async function onlyAction(where: { targetId?: string; reportId?: string; banId?: string }) {
  const rows = await prisma.moderationAction.findMany({ where });
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

beforeEach(() => {
  rooms.moderatePlayer.mockReset();
  rooms.moderatePlayer.mockResolvedValue({ applied: [] });
});

// -------------------------------------------------------------------- ban ----

describe("banUser", () => {
  it("creates the ban, logs one action, closes the report and reaches the account's recent rooms", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const reporter = await account("Reporter");
    const target = await account("Target");
    const reportId = await openReport(reporter, target);
    await prisma.roomVisit.createMany({
      data: [
        { userId: target.id, room: "HJKLM", lastAt: new Date(NOW.getTime() - 2 * DAY) },
        { userId: target.id, room: "BCDFG", lastAt: new Date(NOW.getTime() - 60_000) },
        { userId: target.id, room: "QRSTV", lastAt: new Date(NOW.getTime() - VISIT_TTL_MS - DAY) },
      ],
    });
    rooms.moderatePlayer.mockResolvedValue({ applied: ["BCDFG"] });

    const result = await logging(1, () =>
      banUser(prisma, {
        moderator,
        userId: target.id,
        reason: "  Insults in the chat.\r\nBe kind.  ",
        duration: "7d",
        reportId,
        note: "first offence",
        now: NOW,
      }),
    );

    const expiresAt = new Date(NOW.getTime() + 7 * DAY);
    expect(result).toEqual({
      ok: true,
      banId: expect.any(String),
      name: target.name,
      expiresAt,
      live: { reached: true, applied: ["BCDFG"] },
    });
    if (!result.ok) throw new Error("unreachable");

    const ban = await prisma.ban.findUniqueOrThrow({ where: { id: result.banId } });
    expect(ban).toMatchObject({
      userId: target.id,
      reason: "Insults in the chat.\nBe kind.",
      createdById: moderator.id,
      reportId,
      createdAt: NOW,
      expiresAt,
      revokedAt: null,
    });
    const action = await onlyAction({ banId: ban.id });
    expect(action).toMatchObject({
      kind: "ban",
      moderatorId: moderator.id,
      targetId: target.id,
      targetName: target.name,
      reportId,
      note: "first offence",
      details: { duration: "7d", expiresAt: expiresAt.toISOString() },
    });
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: "actioned",
      resolvedAt: NOW,
      resolvedById: moderator.id,
    });
    expect(rooms.moderatePlayer).toHaveBeenCalledOnce();
    expect(rooms.moderatePlayer).toHaveBeenCalledWith({
      identity: `u:${target.id}`,
      rooms: ["BCDFG", "HJKLM"],
      action: { kind: "ban" },
    });
    expect((await activeBan(prisma, target.id, NOW))?.id).toBe(ban.id);
  });

  it("keeps the ban when the rooms Worker cannot be reached, and says so", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const target = await account("Target");
    rooms.moderatePlayer.mockRejectedValueOnce(new rooms.RoomsUnavailableError("timeout"));

    const result = await logging(1, () =>
      banUser(prisma, { moderator, userId: target.id, reason: "Spam", duration: "1d", now: NOW }),
    );
    expect(result).toMatchObject({ ok: true, live: { reached: false } });
    expect(await activeBan(prisma, target.id, NOW)).not.toBeNull();

    // Any other failure of the call (bad answer, missing env) is treated the same way.
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rooms.moderatePlayer.mockRejectedValueOnce(new Error("bad answer"));
    const again = await logging(1, () =>
      banUser(prisma, { moderator, userId: target.id, reason: "Spam", duration: "1d", now: NOW }),
    );
    expect(again).toMatchObject({ ok: true, live: { reached: false } });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("durations: 1 day, 30 days, permanent; a second ban adds one and the longest wins", async () => {
    const moderator = await account("Mod", "ADMIN");
    for (const [duration, ms] of [
      ["1d", DAY],
      ["30d", 30 * DAY],
    ] as const) {
      const target = await account("Target");
      const result = await banUser(prisma, {
        moderator,
        userId: target.id,
        reason: "Cheating",
        duration,
        now: NOW,
      });
      expect(result).toMatchObject({ ok: true, expiresAt: new Date(NOW.getTime() + ms) });
      const ban = await activeBan(prisma, target.id, NOW);
      expect(ban?.expiresAt).toEqual(new Date(NOW.getTime() + ms));
      expect(await activeBan(prisma, target.id, new Date(NOW.getTime() + ms))).toBeNull();
    }

    const target = await account("Target");
    await banUser(prisma, {
      moderator,
      userId: target.id,
      reason: "Hate",
      duration: "7d",
      now: NOW,
    });
    const permanent = await logging(1, () =>
      banUser(prisma, {
        moderator,
        userId: target.id,
        reason: "Hate, again",
        duration: "permanent",
        now: NOW,
      }),
    );
    expect(permanent).toMatchObject({ ok: true, expiresAt: null });
    expect(await prisma.ban.count({ where: { userId: target.id } })).toBe(2);
    const active = await activeBan(prisma, target.id, new Date(NOW.getTime() + 365 * DAY));
    expect(active).toMatchObject({ reason: "Hate, again", expiresAt: null });
    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { targetId: target.id, details: { path: ["duration"], equals: "permanent" } },
    });
    expect(action.details).toEqual({ duration: "permanent", expiresAt: null });
  });

  it("refuses bad input without writing anything or calling the Worker", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const reporter = await account("Reporter");
    const target = await account("Target");
    const someoneElse = await account("Other");
    const reportOnSomeoneElse = await openReport(reporter, someoneElse);
    const base = { moderator, userId: target.id, reason: "Spam", duration: "7d", now: NOW };

    const cases: Array<[Partial<Parameters<typeof banUser>[1]>, string]> = [
      [{ reason: "   " }, "reasonRequired"],
      [{ reason: "x".repeat(501) }, "reasonTooLong"],
      [{ note: "x".repeat(1001) }, "noteTooLong"],
      [{ duration: "2d" }, "invalidDuration"],
      [{ duration: "" }, "invalidDuration"],
      [{ userId: crypto.randomUUID() }, "userNotFound"],
      [{ userId: "not-a-uuid" }, "userNotFound"],
      [{ reportId: reportOnSomeoneElse }, "reportNotFound"],
      [{ reportId: crypto.randomUUID() }, "reportNotFound"],
    ];
    for (const [change, error] of cases) {
      expect(await logging(0, () => banUser(prisma, { ...base, ...change }))).toEqual({
        ok: false,
        error,
      });
    }
    expect(await prisma.ban.count({ where: { userId: target.id } })).toBe(0);
    expect(rooms.moderatePlayer).not.toHaveBeenCalled();
    // The full 500 characters are accepted.
    expect(
      await banUser(prisma, { ...base, reason: "é".repeat(500), note: "n".repeat(1000) }),
    ).toMatchObject({ ok: true });
  });
});

// ------------------------------------------------------------ permissions ----

describe("permissions", () => {
  it("nobody acts on themselves; moderators cannot touch moderators or admins; admins can touch moderators but not admins", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const otherModerator = await account("Mod", "MODERATOR");
    const admin = await account("Admin", "ADMIN");
    const otherAdmin = await account("Admin", "ADMIN");
    const player = await account("Player");
    const ban = (who: Moderator, userId: string) =>
      banUser(prisma, { moderator: who, userId, reason: "r", duration: "1d", now: NOW });
    const rename = (who: Moderator, userId: string) =>
      forceRename(prisma, { moderator: who, userId, now: NOW });

    const refusals: Array<[Moderator, string, string]> = [
      [moderator, moderator.id, "self"],
      [admin, admin.id, "self"],
      [moderator, otherModerator.id, "protectedTarget"],
      [moderator, admin.id, "protectedTarget"],
      [admin, otherAdmin.id, "protectedTarget"],
      [{ id: player.id, role: "USER" }, otherModerator.id, "forbidden"],
      [{ id: player.id, role: "USER" }, moderator.id, "forbidden"],
    ];
    for (const [who, userId, error] of refusals) {
      expect(await logging(0, () => ban(who, userId))).toEqual({ ok: false, error });
      expect(await logging(0, () => rename(who, userId))).toEqual({ ok: false, error });
    }
    const userCannot = { id: player.id, role: "USER" as const };
    const reportId = await openReport(otherModerator, player);
    expect(await dismissReport(prisma, { moderator: userCannot, reportId })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await addNote(prisma, { moderator: userCannot, reportId, note: "n" })).toEqual({
      ok: false,
      error: "forbidden",
    });

    // An admin can ban (and rename) a moderator; a moderator can ban a player.
    expect(await logging(1, () => ban(admin, otherModerator.id))).toMatchObject({ ok: true });
    expect(await logging(1, () => rename(admin, otherModerator.id))).toMatchObject({ ok: true });
    expect(await logging(1, () => ban(moderator, player.id))).toMatchObject({ ok: true });
    expect(rooms.moderatePlayer).toHaveBeenCalledTimes(3);

    // Lifting a ban follows the same rules (here: the moderator's own ban).
    const own = await activeBan(prisma, otherModerator.id, NOW);
    expect(
      await logging(0, () =>
        unbanUser(prisma, { moderator: otherModerator, banId: own!.id, now: NOW }),
      ),
    ).toEqual({ ok: false, error: "self" });
    expect(
      await logging(0, () => unbanUser(prisma, { moderator, banId: own!.id, now: NOW })),
    ).toEqual({ ok: false, error: "protectedTarget" });
    expect(
      await logging(1, () => unbanUser(prisma, { moderator: admin, banId: own!.id, now: NOW })),
    ).toMatchObject({ ok: true });
  });
});

// ------------------------------------------------------------------ unban ----

describe("unbanUser", () => {
  it("revokes the ban, logs one action and refuses a second time", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const other = await account("Mod", "MODERATOR");
    const target = await account("Target");
    const reporter = await account("Reporter");
    const reportId = await openReport(reporter, target);
    const banned = await banUser(prisma, {
      moderator,
      userId: target.id,
      reason: "Spam",
      duration: "30d",
      reportId,
      now: NOW,
    });
    if (!banned.ok) throw new Error("ban refused");
    rooms.moderatePlayer.mockClear();

    const later = new Date(NOW.getTime() + DAY);
    const result = await logging(1, () =>
      unbanUser(prisma, {
        moderator: other,
        banId: banned.banId,
        note: "appeal accepted",
        now: later,
      }),
    );
    expect(result).toEqual({ ok: true, name: target.name });
    expect(await prisma.ban.findUniqueOrThrow({ where: { id: banned.banId } })).toMatchObject({
      revokedAt: later,
      revokedById: other.id,
    });
    expect(await activeBan(prisma, target.id, later)).toBeNull();
    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { banId: banned.banId, kind: "unban" },
    });
    expect(action).toMatchObject({
      moderatorId: other.id,
      targetId: target.id,
      targetName: target.name,
      reportId,
      note: "appeal accepted",
      details: { expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString() },
    });
    expect(rooms.moderatePlayer).not.toHaveBeenCalled();

    expect(
      await logging(0, () => unbanUser(prisma, { moderator, banId: banned.banId, now: later })),
    ).toEqual({ ok: false, error: "banNotActive" });
    expect(
      await logging(0, () => unbanUser(prisma, { moderator, banId: crypto.randomUUID() })),
    ).toEqual({ ok: false, error: "banNotFound" });
    expect(await logging(0, () => unbanUser(prisma, { moderator, banId: "nope" }))).toEqual({
      ok: false,
      error: "banNotFound",
    });
  });

  it("an expired ban cannot be lifted", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const target = await account("Target");
    const banned = await banUser(prisma, {
      moderator,
      userId: target.id,
      reason: "Spam",
      duration: "1d",
      now: NOW,
    });
    if (!banned.ok) throw new Error("ban refused");
    expect(
      await unbanUser(prisma, {
        moderator,
        banId: banned.banId,
        now: new Date(NOW.getTime() + 2 * DAY),
      }),
    ).toEqual({ ok: false, error: "banNotActive" });
  });
});

// ----------------------------------------------------------- force rename ----

describe("forceRename", () => {
  it("gives a free `Player NNNNN` name, clears the rename cooldown, logs one action and renames in live rooms", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const reporter = await account("Reporter");
    const target = await account("Rude");
    const reportId = await openReport(reporter, target);
    await prisma.user.update({
      where: { id: target.id },
      data: { displayNameChangedAt: new Date(NOW.getTime() - DAY) },
    });
    // "Player 11111" is taken (case and accents ignored): the next candidate is used.
    await prisma.user.create({
      data: {
        email: `player-11111-${crypto.randomUUID()}@example.test`,
        displayName: "PLAYER 11111",
        displayNameKey: nameKey("PLAYER 11111"),
      },
    });
    await prisma.roomVisit.create({
      data: { userId: target.id, room: "BCDFG", lastAt: NOW },
    });
    rooms.moderatePlayer.mockResolvedValue({ applied: ["BCDFG"] });
    const candidates = ["11111", "22222"];

    const result = await logging(1, () =>
      forceRename(prisma, {
        moderator,
        userId: target.id,
        reportId,
        note: "slur in the name",
        now: NOW,
        digits: () => candidates.shift() ?? "99999",
      }),
    );
    expect(result).toEqual({
      ok: true,
      from: target.name,
      to: "Player 22222",
      live: { reached: true, applied: ["BCDFG"] },
    });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { displayName: true, displayNameKey: true, displayNameChangedAt: true },
      }),
    ).toEqual({
      displayName: "Player 22222",
      displayNameKey: "player 22222",
      displayNameChangedAt: null,
    });
    const action = await onlyAction({ targetId: target.id });
    expect(action).toMatchObject({
      kind: "rename",
      moderatorId: moderator.id,
      targetName: target.name,
      reportId,
      note: "slur in the name",
      details: { from: target.name, to: "Player 22222" },
    });
    expect((await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).status).toBe(
      "actioned",
    );
    expect(rooms.moderatePlayer).toHaveBeenCalledWith({
      identity: `u:${target.id}`,
      rooms: ["BCDFG"],
      action: { kind: "rename", name: "Player 22222" },
    });

    // The player may choose a new name at once.
    expect(await renameAccount(prisma, target.id, uniqueName("Fresh"))).toMatchObject({ ok: true });
  });

  it("random names have five digits; an unreachable Worker does not undo the rename", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const target = await account("Target");
    rooms.moderatePlayer.mockRejectedValueOnce(new rooms.RoomsUnavailableError("down"));
    const result = await logging(1, () =>
      forceRename(prisma, { moderator, userId: target.id, now: NOW }),
    );
    expect(result).toMatchObject({ ok: true, from: target.name, live: { reached: false } });
    if (!result.ok) throw new Error("unreachable");
    expect(result.to).toMatch(/^Player \d{5}$/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).displayName).toBe(
      result.to,
    );
  });

  it("gives up after too many clashes, and refuses unknown accounts and foreign reports", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const reporter = await account("Reporter");
    const target = await account("Target");
    const someoneElse = await account("Other");
    await prisma.user.create({
      data: {
        email: `player-33333-${crypto.randomUUID()}@example.test`,
        displayName: "Player 33333",
        displayNameKey: nameKey("Player 33333"),
      },
    });
    expect(
      await logging(0, () =>
        forceRename(prisma, { moderator, userId: target.id, digits: () => "33333" }),
      ),
    ).toEqual({ ok: false, error: "noFreeName" });
    expect(
      await logging(0, () => forceRename(prisma, { moderator, userId: crypto.randomUUID() })),
    ).toEqual({ ok: false, error: "userNotFound" });
    const foreign = await openReport(reporter, someoneElse);
    expect(
      await logging(0, () =>
        forceRename(prisma, { moderator, userId: target.id, reportId: foreign }),
      ),
    ).toEqual({ ok: false, error: "reportNotFound" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).displayName).toBe(
      target.name,
    );
    expect(rooms.moderatePlayer).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------- dismiss & notes ----

describe("dismissReport and addNote", () => {
  it("dismisses an open report once, with its note", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const reporter = await account("Reporter");
    const target = await account("Target");
    const reportId = await openReport(reporter, target);

    expect(
      await logging(1, () =>
        dismissReport(prisma, { moderator, reportId, note: "banter between friends", now: NOW }),
      ),
    ).toEqual({ ok: true });
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: "dismissed",
      resolvedAt: NOW,
      resolvedById: moderator.id,
    });
    expect(await onlyAction({ reportId })).toMatchObject({
      kind: "dismiss",
      moderatorId: moderator.id,
      targetId: target.id,
      targetName: target.name,
      note: "banter between friends",
    });

    expect(await logging(0, () => dismissReport(prisma, { moderator, reportId }))).toEqual({
      ok: false,
      error: "reportClosed",
    });
    expect(
      await logging(0, () => dismissReport(prisma, { moderator, reportId: crypto.randomUUID() })),
    ).toEqual({ ok: false, error: "reportNotFound" });
    expect(rooms.moderatePlayer).not.toHaveBeenCalled();
  });

  it("adds notes on a report or an account, and refuses empty ones", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const reporter = await account("Reporter");
    const target = await account("Target");
    const reportId = await openReport(reporter, target);

    expect(
      await logging(1, () => addNote(prisma, { moderator, reportId, note: "  watch this one  " })),
    ).toEqual({ ok: true });
    expect(await onlyAction({ reportId })).toMatchObject({
      kind: "note",
      targetId: target.id,
      targetName: target.name,
      note: "watch this one",
    });
    expect(
      await logging(1, () => addNote(prisma, { moderator, userId: reporter.id, note: "e-mail" })),
    ).toEqual({ ok: true });
    expect(await onlyAction({ targetId: reporter.id })).toMatchObject({
      kind: "note",
      reportId: null,
      targetName: reporter.name,
    });
    // The report stays open.
    expect((await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).status).toBe(
      "open",
    );

    for (const [input, error] of [
      [{ reportId, note: "  " }, "noteRequired"],
      [{ reportId, note: "x".repeat(1001) }, "noteTooLong"],
      [{ note: "nothing to attach to" }, "userNotFound"],
      [{ reportId: crypto.randomUUID(), note: "n" }, "reportNotFound"],
      [{ userId: crypto.randomUUID(), note: "n" }, "userNotFound"],
      [{ reportId, userId: reporter.id, note: "n" }, "reportNotFound"],
    ] as const) {
      expect(await logging(0, () => addNote(prisma, { moderator, ...input }))).toEqual({
        ok: false,
        error,
      });
    }
  });
});

// ------------------------------------------------------------ the queue ----

describe("listReports", () => {
  beforeAll(async () => {
    await prisma.moderationAction.deleteMany({});
    await prisma.ban.deleteMany({});
    await prisma.report.deleteMany({});
  });

  it("open reports first, oldest first; with `all`, closed ones follow newest first; 50 per page", async () => {
    const reporter = await account("Reporter");
    const target = await account("Target");
    const other = await account("Other");
    const base = Date.parse("2026-10-01T00:00:00Z");
    const at = (minutes: number) => new Date(base + minutes * 60_000);

    // 51 open reports on `target` (minutes 0..50), one open on `other`, two closed.
    const openIds: string[] = [];
    for (let i = 0; i <= 50; i += 1) {
      openIds.push(await openReport(reporter, target, { receivedAt: at(i) }));
    }
    const otherOpen = await openReport(reporter, other, { receivedAt: at(100) });
    const closedOld = await openReport(reporter, other, {
      receivedAt: at(-10),
      status: "dismissed",
    });
    const closedNew = await openReport(reporter, target, {
      receivedAt: at(200),
      status: "actioned",
    });

    const first = await listReports(prisma, { status: "open", page: 1 });
    expect(first).toMatchObject({ total: 52, openTotal: 52, page: 1, pageCount: 2 });
    expect(first.reports).toHaveLength(REPORTS_PAGE_SIZE);
    expect(first.reports.map((r) => r.id)).toEqual(openIds.slice(0, 50));
    expect(first.reports[0]).toMatchObject({
      targetId: target.id,
      targetName: target.name,
      reporterName: reporter.name,
      reason: "harassment",
      status: "open",
      room: "BCDFG",
      openForTarget: 51,
    });
    const second = await listReports(prisma, { status: "open", page: 2 });
    expect(second.reports.map((r) => r.id)).toEqual([openIds[50], otherOpen]);
    expect(second.reports[1]?.openForTarget).toBe(1);

    const all = await listReports(prisma, { status: "all", page: 2 });
    expect(all).toMatchObject({ total: 54, openTotal: 52, pageCount: 2 });
    expect(all.reports.map((r) => r.id)).toEqual([openIds[50], otherOpen, closedNew, closedOld]);
    expect(all.reports[2]).toMatchObject({ status: "actioned", openForTarget: 51 });

    // A page past the end is empty; nonsense pages read as the first.
    expect((await listReports(prisma, { status: "open", page: 9 })).reports).toEqual([]);
    expect((await listReports(prisma, { status: "open", page: -3 })).page).toBe(1);
  });
});

// ----------------------------------------------------------- one report ----

describe("getReport", () => {
  it("returns the parsed evidence, the target's other reports, active ban and history", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const reporter = await account("Reporter");
    const target = await account("Target");
    const earlier = await openReport(reporter, target, {
      receivedAt: new Date(NOW.getTime() - DAY),
    });
    await addNote(prisma, {
      moderator,
      reportId: earlier,
      note: "older note",
      now: new Date(NOW.getTime() - DAY),
    });
    const reportId = await openReport(reporter, target);
    await banUser(prisma, {
      moderator,
      userId: target.id,
      reason: "Insults",
      duration: "permanent",
      reportId,
      now: NOW,
    });

    const report = await getReport(prisma, reportId);
    expect(report).toMatchObject({
      id: reportId,
      room: "BCDFG",
      reason: "harassment",
      details: "Insults all game long",
      status: "actioned",
      createdAt: new Date(SNAPSHOT_AT),
      resolvedByName: moderator.name,
      reporter: { id: reporter.id, nameAtReport: reporter.name, currentName: reporter.name },
      target: { id: target.id, nameAtReport: target.name, currentName: target.name, role: "USER" },
      evidenceComplete: true,
      activeBan: { reason: "Insults", expiresAt: null },
    });
    expect(report?.evidence).toMatchObject({ status: "playing", game: { number: 2 }, events: [] });
    expect(report?.evidence.chat).toHaveLength(3);
    expect(report?.evidence.members.map((m) => m.pid)).toEqual(["p1", "p2", "p3"]);
    expect(report?.otherReports.map((r) => r.id)).toEqual([earlier]);
    // Newest first: the ban, then the note on the earlier report (about the same account).
    expect(report?.history.map((h) => h.kind)).toEqual(["ban", "note"]);
    expect(report?.history[0]).toMatchObject({ moderatorName: moderator.name, reportId });

    expect(await getReport(prisma, crypto.randomUUID())).toBeNull();
    expect(await getReport(prisma, "../etc")).toBeNull();
  });

  it("salvages evidence that does not parse instead of failing", async () => {
    const reporter = await account("Reporter");
    const target = await account("Target");
    const good = evidence(reporter, target);
    const reportId = await openReport(reporter, target, {
      evidence: {
        ...good,
        status: "weird",
        chat: [good.chat[1], { kind: "player", id: "x" }, good.chat[0]],
        members: "not a list",
        extra: true,
      },
    });
    const report = await getReport(prisma, reportId);
    expect(report?.evidenceComplete).toBe(false);
    expect(report?.evidence).toEqual({
      status: null,
      game: good.game,
      members: [],
      chat: [good.chat[1], good.chat[0]],
      events: [],
    });
    expect(parseEvidence(null)).toEqual({
      evidence: { status: null, game: null, members: [], chat: [], events: [] },
      complete: false,
    });
  });
});

// ------------------------------------------------------------------ bans ----

describe("listActiveBans and findUserByName", () => {
  it("lists only active bans, newest first, and finds accounts by name (case and accents ignored)", async () => {
    const moderator = await account("Mod", "MODERATOR");
    const lifted = await account("Lifted");
    const expired = await account("Expired");
    const active = await account("Active");
    const permanent = await account("Élodie");
    const now = new Date();
    const ban = (userId: string, duration: string, at: Date) =>
      banUser(prisma, { moderator, userId, reason: "r", duration, now: at });

    const liftedBan = await ban(lifted.id, "30d", now);
    if (!liftedBan.ok) throw new Error("ban refused");
    await unbanUser(prisma, { moderator, banId: liftedBan.banId });
    await ban(expired.id, "1d", new Date(now.getTime() - 2 * DAY));
    await ban(active.id, "7d", new Date(now.getTime() - 60_000));
    await ban(permanent.id, "permanent", now);

    const rows = await listActiveBans(prisma);
    const mine = rows.filter((row) =>
      [lifted.id, expired.id, active.id, permanent.id].includes(row.userId),
    );
    expect(mine.map((row) => row.userName)).toEqual([permanent.name, active.name]);
    expect(mine[0]).toMatchObject({ expiresAt: null, createdByName: moderator.name, reason: "r" });

    expect(await findUserByName(prisma, permanent.name.toUpperCase().replace("É", "E"))).toEqual({
      id: permanent.id,
      displayName: permanent.name,
      role: "USER",
    });
    expect(await findUserByName(prisma, "  nobody here  ")).toBeNull();
    expect(await findUserByName(prisma, "x")).toBeNull();
  });
});
