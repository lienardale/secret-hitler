/**
 * Moderation from the admin pages (`app/[locale]/admin/`): the report queue,
 * a report with its evidence, and the moderator actions.
 *
 * Every function takes the database first, so the integration tests call them
 * directly; the server actions only add the origin and role checks. Expected
 * failures come back as `{ ok: false, error }` keys (`admin.errors.*`), never
 * thrown.
 *
 * - **Every action writes exactly one `ModerationAction` row**, in the same
 *   transaction as its effect (ban, unban, rename, dismiss, note).
 * - **Permissions** (ban, unban, force rename): nobody acts on their own
 *   account; a MODERATOR cannot act on a MODERATOR or an ADMIN; an ADMIN can
 *   act on a MODERATOR but not on another ADMIN. Dismissals and notes are open
 *   to every moderator.
 * - **Banning someone already banned adds a new ban**: the longest one wins
 *   (`activeBan`), so a moderator can escalate (7 days → permanent) from a new
 *   report without lifting the first ban. Each ban is listed and lifted on its
 *   own.
 * - **Live rooms**: after a ban or a forced rename commits, the rooms Worker
 *   applies it to the account's live rooms (`moderatePlayer`: the rooms the
 *   account got a ticket for this week, plus the public rooms the lobby knows).
 *   If the Worker cannot be reached the action still stands (tickets are
 *   refused / the new name is used from the next ticket on) and the result says
 *   `live.reached: false` so the moderator knows.
 * - **Force rename**: the moderator does not type a name. The account becomes
 *   `Player NNNNN` (5 random digits, retried on a clash) and
 *   `displayNameChangedAt` is cleared so the player may choose a new name at
 *   once.
 */
import { randomInt } from "node:crypto";

import {
  chatMessageSchema,
  checkDisplayName,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  gameEventSchema,
  nameKey,
  normalizeDisplayName,
  reportEvidenceSchema,
  type ModerationAction as LiveAction,
  type ReportEvidence,
} from "@sh/protocol";

import {
  BAN_REASON_MAX,
  BANS_LIST_MAX,
  isBanDuration,
  NOTE_MAX,
  REPORTS_PAGE_SIZE,
  type BanDuration,
} from "@/components/admin/constants";
import { isDisplayNameTaken } from "@/lib/auth/display-name";
import { isKnownPrismaError } from "@/lib/db/errors";
import { isUuid } from "@/lib/games/ids";
import type {
  ModerationKind,
  PrismaClient,
  ReportReason,
  ReportStatus,
  UserRole,
} from "@/lib/generated/prisma/client";
import { moderatePlayer, RoomsUnavailableError } from "@/lib/rooms/api";

import { activeBan, type ActiveBan } from "./bans";
import { recentRooms } from "./visits";

export type AdminDb = PrismaClient;

export type ModeratorRole = "MODERATOR" | "ADMIN";

export function isModeratorRole(role: UserRole): role is ModeratorRole {
  return role === "MODERATOR" || role === "ADMIN";
}

/** The account acting (read from the session by the caller, never from a form). */
export interface Moderator {
  id: string;
  role: UserRole;
}

export type PermissionError = "forbidden" | "self" | "protectedTarget";

/** Why `moderator` may not ban, unban or rename `target`, or null when allowed. */
export function moderationRefusal(
  moderator: Moderator,
  target: { id: string; role: UserRole },
): PermissionError | null {
  if (!isModeratorRole(moderator.role)) return "forbidden";
  if (target.id.toLowerCase() === moderator.id.toLowerCase()) return "self";
  if (target.role === "ADMIN") return "protectedTarget";
  if (target.role === "MODERATOR" && moderator.role !== "ADMIN") return "protectedTarget";
  return null;
}

const DAY_MS = 24 * 60 * 60_000;
const DURATION_MS: Record<Exclude<BanDuration, "permanent">, number> = {
  "1d": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

/** When a ban of this length starting `now` ends; null for a permanent one. */
export function banExpiry(duration: BanDuration, now: Date): Date | null {
  return duration === "permanent" ? null : new Date(now.getTime() + DURATION_MS[duration]);
}

/** Free text from a form: CRLF folded to LF, trimmed. */
function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").trim();
}

function length(text: string): number {
  return [...text].length;
}

/** P2003: a row the write points at (the account) was deleted in between. */
function isMissingRelation(error: unknown): boolean {
  return isKnownPrismaError(error) && error.code === "P2003";
}

// ------------------------------------------------------------ live rooms ----

export type LiveOutcome = { reached: true; applied: string[] } | { reached: false };

/** Applies a committed ban / rename to the account's live rooms. Never throws. */
async function applyLive(
  db: AdminDb,
  userId: string,
  action: LiveAction,
  now: Date,
): Promise<LiveOutcome> {
  try {
    const rooms = await recentRooms(db, userId, now);
    const { applied } = await moderatePlayer({ identity: `u:${userId}`, rooms, action });
    return { reached: true, applied };
  } catch (error) {
    if (!(error instanceof RoomsUnavailableError)) {
      console.error(
        `[moderation] ${action.kind} not applied to live rooms:`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return { reached: false };
  }
}

// ----------------------------------------------------------------- queue ----

export type ReportFilter = "open" | "all";

export interface ReportRow {
  id: string;
  room: string;
  reason: ReportReason;
  status: ReportStatus;
  details: string;
  reporterName: string;
  targetId: string | null;
  targetName: string;
  createdAt: Date;
  receivedAt: Date;
  /** Open reports against the same account (this one included when open). */
  openForTarget: number;
}

export interface ReportPage {
  reports: ReportRow[];
  /** Reports matching the filter. */
  total: number;
  /** Open reports, whatever the filter. */
  openTotal: number;
  page: number;
  pageCount: number;
}

const REPORT_ROW_SELECT = {
  id: true,
  room: true,
  reason: true,
  status: true,
  details: true,
  reporterName: true,
  targetId: true,
  targetName: true,
  createdAt: true,
  receivedAt: true,
} as const;

/**
 * The queue, `REPORTS_PAGE_SIZE` per page. Open reports come first, oldest
 * first (work from the top); with `all`, the closed ones follow, newest first.
 */
export async function listReports(
  db: AdminDb,
  { status, page: rawPage }: { status: ReportFilter; page: number },
): Promise<ReportPage> {
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const skip = (page - 1) * REPORTS_PAGE_SIZE;
  const [openTotal, closedTotal] = await Promise.all([
    db.report.count({ where: { status: "open" } }),
    status === "all" ? db.report.count({ where: { status: { not: "open" } } }) : 0,
  ]);

  const open =
    skip < openTotal
      ? await db.report.findMany({
          where: { status: "open" },
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          skip,
          take: REPORTS_PAGE_SIZE,
          select: REPORT_ROW_SELECT,
        })
      : [];
  const room = REPORTS_PAGE_SIZE - open.length;
  const closed =
    status === "all" && room > 0
      ? await db.report.findMany({
          where: { status: { not: "open" } },
          orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
          skip: Math.max(0, skip - openTotal),
          take: room,
          select: REPORT_ROW_SELECT,
        })
      : [];
  const rows = [...open, ...closed];

  const targetIds = [
    ...new Set(rows.flatMap((row) => (row.targetId === null ? [] : [row.targetId]))),
  ];
  const counts =
    targetIds.length === 0
      ? []
      : await db.report.groupBy({
          by: ["targetId"],
          where: { status: "open", targetId: { in: targetIds } },
          _count: { _all: true },
        });
  const openBy = new Map(counts.map((count) => [count.targetId, count._count._all]));

  const total = openTotal + closedTotal;
  return {
    reports: rows.map((row) => ({
      ...row,
      openForTarget: row.targetId === null ? 0 : (openBy.get(row.targetId) ?? 0),
    })),
    total,
    openTotal,
    page,
    pageCount: Math.max(1, Math.ceil(total / REPORTS_PAGE_SIZE)),
  };
}

// --------------------------------------------------------------- evidence ----

/** What the admin page shows of a report's evidence (each part may be partial). */
export interface EvidenceView {
  status: ReportEvidence["status"] | null;
  game: ReportEvidence["game"];
  members: ReportEvidence["members"];
  chat: ReportEvidence["chat"];
  events: ReportEvidence["events"];
}

const memberSchema = reportEvidenceSchema.shape.members.element;

function salvage<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = parse(item);
    return parsed === null ? [] : [parsed];
  });
}

/**
 * The stored evidence, checked against the protocol schema. Evidence that does
 * not parse (an older room version, a hand-edited row) is salvaged item by
 * item and flagged `complete: false` instead of failing the page.
 */
export function parseEvidence(raw: unknown): { evidence: EvidenceView; complete: boolean } {
  const full = reportEvidenceSchema.safeParse(raw);
  if (full.success) return { evidence: full.data, complete: true };

  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const status = reportEvidenceSchema.shape.status.safeParse(record.status);
  const game = reportEvidenceSchema.shape.game.safeParse(record.game);
  return {
    evidence: {
      status: status.success ? status.data : null,
      game: game.success ? game.data : null,
      members: salvage(record.members, (item) => {
        const parsed = memberSchema.safeParse(item);
        return parsed.success ? parsed.data : null;
      }),
      chat: salvage(record.chat, (item) => {
        const parsed = chatMessageSchema.safeParse(item);
        return parsed.success ? parsed.data : null;
      }),
      events: salvage(record.events, (item) => {
        const parsed = gameEventSchema.safeParse(item);
        return parsed.success ? parsed.data : null;
      }),
    },
    complete: false,
  };
}

// ----------------------------------------------------------------- report ----

export interface HistoryEntry {
  id: string;
  kind: ModerationKind;
  moderatorName: string | null;
  targetName: string | null;
  reportId: string | null;
  note: string;
  details: unknown;
  createdAt: Date;
}

export interface OtherReport {
  id: string;
  reason: ReportReason;
  status: ReportStatus;
  reporterName: string;
  receivedAt: Date;
}

export interface ReportParty {
  /** null once the account is deleted. */
  id: string | null;
  /** The name in the room when the report was made. */
  nameAtReport: string;
  /** The account's display name now (null: deleted, or no name). */
  currentName: string | null;
}

export interface ReportDetail {
  id: string;
  room: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  /** When the room took the snapshot. */
  createdAt: Date;
  receivedAt: Date;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  reporter: ReportParty;
  target: ReportParty & { role: UserRole | null };
  evidence: EvidenceView;
  /** False when part of the stored evidence could not be read. */
  evidenceComplete: boolean;
  /** The target's other reports, newest first. */
  otherReports: OtherReport[];
  /** The target's active ban (the longest), if any. */
  activeBan: ActiveBan | null;
  /** Moderation of the target and of this report, newest first. */
  history: HistoryEntry[];
}

const HISTORY_LIMIT = 50;
const OTHER_REPORTS_LIMIT = 20;

export async function moderationHistory(
  db: AdminDb,
  { userId, reportId }: { userId?: string | null; reportId?: string },
): Promise<HistoryEntry[]> {
  const or = [...(userId ? [{ targetId: userId }] : []), ...(reportId ? [{ reportId }] : [])];
  if (or.length === 0) return [];
  const rows = await db.moderationAction.findMany({
    where: { OR: or },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: HISTORY_LIMIT,
    select: {
      id: true,
      kind: true,
      targetName: true,
      reportId: true,
      note: true,
      details: true,
      createdAt: true,
      moderator: { select: { displayName: true } },
    },
  });
  return rows.map(({ moderator, ...row }) => ({
    ...row,
    moderatorName: moderator?.displayName ?? null,
  }));
}

/** A report with everything a moderator needs to decide, or null. */
export async function getReport(
  db: AdminDb,
  id: string,
  now: Date = new Date(),
): Promise<ReportDetail | null> {
  if (!isUuid(id)) return null;
  const report = await db.report.findUnique({
    where: { id },
    include: {
      reporter: { select: { displayName: true } },
      target: { select: { displayName: true, role: true } },
      resolvedBy: { select: { displayName: true } },
    },
  });
  if (!report) return null;
  const { evidence, complete } = parseEvidence(report.evidence);
  const targetId = report.targetId;

  const [otherReports, ban, history] = await Promise.all([
    targetId
      ? db.report.findMany({
          where: { targetId, id: { not: report.id } },
          orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
          take: OTHER_REPORTS_LIMIT,
          select: { id: true, reason: true, status: true, reporterName: true, receivedAt: true },
        })
      : [],
    targetId ? activeBan(db, targetId, now) : null,
    moderationHistory(db, { userId: targetId, reportId: report.id }),
  ]);

  return {
    id: report.id,
    room: report.room,
    reason: report.reason,
    details: report.details,
    status: report.status,
    createdAt: report.createdAt,
    receivedAt: report.receivedAt,
    resolvedAt: report.resolvedAt,
    resolvedByName: report.resolvedBy?.displayName ?? null,
    reporter: {
      id: report.reporterId,
      nameAtReport: report.reporterName,
      currentName: report.reporter?.displayName ?? null,
    },
    target: {
      id: targetId,
      nameAtReport: report.targetName,
      currentName: report.target?.displayName ?? null,
      role: report.target?.role ?? null,
    },
    evidence,
    evidenceComplete: complete,
    otherReports,
    activeBan: ban,
    history,
  };
}

// --------------------------------------------------------- shared checks ----

interface Target {
  id: string;
  role: UserRole;
  displayName: string | null;
}

async function loadTarget(db: AdminDb, userId: string): Promise<Target | null> {
  if (!isUuid(userId)) return null;
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, displayName: true },
  });
}

/** The report an action closes: it must exist and be about `userId`. */
async function linkedReport(
  db: AdminDb,
  reportId: string | undefined,
  userId: string,
): Promise<{ id: string } | null | "missing"> {
  if (reportId === undefined || reportId === "") return null;
  if (!isUuid(reportId)) return "missing";
  const report = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, targetId: true },
  });
  if (!report || report.targetId?.toLowerCase() !== userId.toLowerCase()) return "missing";
  return { id: report.id };
}

// -------------------------------------------------------------------- ban ----

export type BanError =
  | PermissionError
  | "userNotFound"
  | "reportNotFound"
  | "reasonRequired"
  | "reasonTooLong"
  | "noteTooLong"
  | "invalidDuration";

export interface BanInput {
  moderator: Moderator;
  userId: string;
  /** Shown to the banned player (statement of reasons). */
  reason: string;
  duration: string;
  /** The report this ban closes (marked `actioned`). */
  reportId?: string;
  /** For moderators only. */
  note?: string;
  now?: Date;
}

export type BanOutcome =
  | {
      ok: true;
      banId: string;
      /** The banned account's display name. */
      name: string | null;
      /** null: permanent. */
      expiresAt: Date | null;
      live: LiveOutcome;
    }
  | { ok: false; error: BanError };

export async function banUser(db: AdminDb, input: BanInput): Promise<BanOutcome> {
  const { moderator } = input;
  const now = input.now ?? new Date();
  if (!isModeratorRole(moderator.role)) return { ok: false, error: "forbidden" };
  const reason = cleanText(input.reason);
  const note = cleanText(input.note);
  if (reason === "") return { ok: false, error: "reasonRequired" };
  if (length(reason) > BAN_REASON_MAX) return { ok: false, error: "reasonTooLong" };
  if (length(note) > NOTE_MAX) return { ok: false, error: "noteTooLong" };
  if (!isBanDuration(input.duration)) return { ok: false, error: "invalidDuration" };
  const duration = input.duration;

  const target = await loadTarget(db, input.userId);
  if (!target) return { ok: false, error: "userNotFound" };
  const refusal = moderationRefusal(moderator, target);
  if (refusal) return { ok: false, error: refusal };
  const report = await linkedReport(db, input.reportId, target.id);
  if (report === "missing") return { ok: false, error: "reportNotFound" };

  const expiresAt = banExpiry(duration, now);
  let banId: string;
  try {
    banId = await db.$transaction(async (tx) => {
      const ban = await tx.ban.create({
        data: {
          userId: target.id,
          reason,
          createdById: moderator.id,
          reportId: report?.id ?? null,
          createdAt: now,
          expiresAt,
        },
        select: { id: true },
      });
      await tx.moderationAction.create({
        data: {
          kind: "ban",
          moderatorId: moderator.id,
          targetId: target.id,
          targetName: target.displayName,
          reportId: report?.id ?? null,
          banId: ban.id,
          note,
          details: { duration, expiresAt: expiresAt?.toISOString() ?? null },
          createdAt: now,
        },
      });
      if (report) {
        await tx.report.update({
          where: { id: report.id },
          data: { status: "actioned", resolvedAt: now, resolvedById: moderator.id },
        });
      }
      return ban.id;
    });
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, error: "userNotFound" };
    throw error;
  }

  const live = await applyLive(db, target.id, { kind: "ban" }, now);
  return { ok: true, banId, name: target.displayName, expiresAt, live };
}

// ------------------------------------------------------------------ unban ----

export type UnbanError = PermissionError | "banNotFound" | "banNotActive" | "noteTooLong";

export type UnbanOutcome = { ok: true; name: string | null } | { ok: false; error: UnbanError };

/**
 * Lifts one ban. The rooms Worker is not called: tickets are checked against
 * Postgres, so the player can join rooms again at once.
 */
export async function unbanUser(
  db: AdminDb,
  input: { moderator: Moderator; banId: string; note?: string; now?: Date },
): Promise<UnbanOutcome> {
  const { moderator } = input;
  const now = input.now ?? new Date();
  if (!isModeratorRole(moderator.role)) return { ok: false, error: "forbidden" };
  const note = cleanText(input.note);
  if (length(note) > NOTE_MAX) return { ok: false, error: "noteTooLong" };
  if (!isUuid(input.banId)) return { ok: false, error: "banNotFound" };

  const ban = await db.ban.findUnique({
    where: { id: input.banId },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      reportId: true,
      user: { select: { id: true, role: true, displayName: true } },
    },
  });
  if (!ban) return { ok: false, error: "banNotFound" };
  if (ban.revokedAt !== null || (ban.expiresAt !== null && ban.expiresAt <= now)) {
    return { ok: false, error: "banNotActive" };
  }
  const refusal = moderationRefusal(moderator, ban.user);
  if (refusal) return { ok: false, error: refusal };

  const done = await db.$transaction(async (tx) => {
    const { count } = await tx.ban.updateMany({
      where: { id: ban.id, revokedAt: null },
      data: { revokedAt: now, revokedById: moderator.id },
    });
    if (count !== 1) return false;
    await tx.moderationAction.create({
      data: {
        kind: "unban",
        moderatorId: moderator.id,
        targetId: ban.user.id,
        targetName: ban.user.displayName,
        reportId: ban.reportId,
        banId: ban.id,
        note,
        details: { expiresAt: ban.expiresAt?.toISOString() ?? null },
        createdAt: now,
      },
    });
    return true;
  });
  if (!done) return { ok: false, error: "banNotActive" };
  return { ok: true, name: ban.user.displayName };
}

// ----------------------------------------------------------- force rename ----

export type ForceRenameError =
  PermissionError | "userNotFound" | "reportNotFound" | "noteTooLong" | "noFreeName";

export type ForceRenameOutcome =
  | { ok: true; from: string; to: string; live: LiveOutcome }
  | { ok: false; error: ForceRenameError };

/** Candidate names tried before giving up (100 000 numbers: a clash is rare). */
const RENAME_ATTEMPTS = 20;

function randomDigits(): string {
  return String(randomInt(0, 100_000)).padStart(5, "0");
}

export async function forceRename(
  db: AdminDb,
  input: {
    moderator: Moderator;
    userId: string;
    reportId?: string;
    note?: string;
    now?: Date;
    /** Five digits per call (tests make clashes happen). */
    digits?: () => string;
  },
): Promise<ForceRenameOutcome> {
  const { moderator } = input;
  const now = input.now ?? new Date();
  const digits = input.digits ?? randomDigits;
  if (!isModeratorRole(moderator.role)) return { ok: false, error: "forbidden" };
  const note = cleanText(input.note);
  if (length(note) > NOTE_MAX) return { ok: false, error: "noteTooLong" };

  const target = await loadTarget(db, input.userId);
  if (!target || target.displayName === null) return { ok: false, error: "userNotFound" };
  const refusal = moderationRefusal(moderator, target);
  if (refusal) return { ok: false, error: refusal };
  const report = await linkedReport(db, input.reportId, target.id);
  if (report === "missing") return { ok: false, error: "reportNotFound" };

  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    const name = `Player ${digits()}`;
    if (checkDisplayName(name) !== null || name === target.displayName) continue;
    let from: string | null;
    try {
      from = await db.$transaction(async (tx) => {
        const before = await tx.user.findUnique({
          where: { id: target.id },
          select: { displayName: true },
        });
        if (!before || before.displayName === null) return null;
        await tx.user.update({
          where: { id: target.id },
          data: { displayName: name, displayNameKey: nameKey(name), displayNameChangedAt: null },
        });
        await tx.moderationAction.create({
          data: {
            kind: "rename",
            moderatorId: moderator.id,
            targetId: target.id,
            targetName: before.displayName,
            reportId: report?.id ?? null,
            note,
            details: { from: before.displayName, to: name },
            createdAt: now,
          },
        });
        if (report) {
          await tx.report.update({
            where: { id: report.id },
            data: { status: "actioned", resolvedAt: now, resolvedById: moderator.id },
          });
        }
        return before.displayName;
      });
    } catch (error) {
      if (isDisplayNameTaken(error)) continue;
      throw error;
    }
    if (from === null) return { ok: false, error: "userNotFound" };
    const live = await applyLive(db, target.id, { kind: "rename", name }, now);
    return { ok: true, from, to: name, live };
  }
  return { ok: false, error: "noFreeName" };
}

// ---------------------------------------------------------------- dismiss ----

export type DismissError = "forbidden" | "reportNotFound" | "reportClosed" | "noteTooLong";

export async function dismissReport(
  db: AdminDb,
  input: { moderator: Moderator; reportId: string; note?: string; now?: Date },
): Promise<{ ok: true } | { ok: false; error: DismissError }> {
  const { moderator } = input;
  const now = input.now ?? new Date();
  if (!isModeratorRole(moderator.role)) return { ok: false, error: "forbidden" };
  const note = cleanText(input.note);
  if (length(note) > NOTE_MAX) return { ok: false, error: "noteTooLong" };
  if (!isUuid(input.reportId)) return { ok: false, error: "reportNotFound" };

  const report = await db.report.findUnique({
    where: { id: input.reportId },
    select: {
      id: true,
      status: true,
      targetId: true,
      targetName: true,
      target: { select: { displayName: true } },
    },
  });
  if (!report) return { ok: false, error: "reportNotFound" };
  if (report.status !== "open") return { ok: false, error: "reportClosed" };

  const done = await db.$transaction(async (tx) => {
    const { count } = await tx.report.updateMany({
      where: { id: report.id, status: "open" },
      data: { status: "dismissed", resolvedAt: now, resolvedById: moderator.id },
    });
    if (count !== 1) return false;
    await tx.moderationAction.create({
      data: {
        kind: "dismiss",
        moderatorId: moderator.id,
        targetId: report.targetId,
        targetName: report.target?.displayName ?? report.targetName,
        reportId: report.id,
        note,
        createdAt: now,
      },
    });
    return true;
  });
  return done ? { ok: true } : { ok: false, error: "reportClosed" };
}

// ------------------------------------------------------------------- note ----

export type NoteError =
  "forbidden" | "noteRequired" | "noteTooLong" | "reportNotFound" | "userNotFound";

/** A note on a report and/or an account (at least one of the two). */
export async function addNote(
  db: AdminDb,
  input: { moderator: Moderator; reportId?: string; userId?: string; note: string; now?: Date },
): Promise<{ ok: true } | { ok: false; error: NoteError }> {
  const { moderator } = input;
  const now = input.now ?? new Date();
  if (!isModeratorRole(moderator.role)) return { ok: false, error: "forbidden" };
  const note = cleanText(input.note);
  if (note === "") return { ok: false, error: "noteRequired" };
  if (length(note) > NOTE_MAX) return { ok: false, error: "noteTooLong" };

  let reportId: string | null = null;
  let targetId: string | null = null;
  let targetName: string | null = null;
  if (input.reportId) {
    if (!isUuid(input.reportId)) return { ok: false, error: "reportNotFound" };
    const report = await db.report.findUnique({
      where: { id: input.reportId },
      select: {
        id: true,
        targetId: true,
        targetName: true,
        target: { select: { displayName: true } },
      },
    });
    if (!report) return { ok: false, error: "reportNotFound" };
    reportId = report.id;
    targetId = report.targetId;
    targetName = report.target?.displayName ?? report.targetName;
  }
  if (input.userId) {
    const user = await loadTarget(db, input.userId);
    if (!user) return { ok: false, error: "userNotFound" };
    if (reportId !== null && targetId !== user.id) return { ok: false, error: "reportNotFound" };
    targetId = user.id;
    targetName = user.displayName;
  }
  if (reportId === null && targetId === null) return { ok: false, error: "userNotFound" };

  try {
    await db.moderationAction.create({
      data: {
        kind: "note",
        moderatorId: moderator.id,
        targetId,
        targetName,
        reportId,
        note,
        createdAt: now,
      },
    });
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, error: "userNotFound" };
    throw error;
  }
  return { ok: true };
}

// ------------------------------------------------------------------- bans ----

export interface BanRow {
  id: string;
  userId: string;
  /** The account's display name now. */
  userName: string | null;
  reason: string;
  createdAt: Date;
  /** null: permanent. */
  expiresAt: Date | null;
  createdByName: string | null;
  reportId: string | null;
}

/** Active bans, newest first (`BANS_LIST_MAX` at most). */
export async function listActiveBans(db: AdminDb, now: Date = new Date()): Promise<BanRow[]> {
  const rows = await db.ban.findMany({
    where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: BANS_LIST_MAX,
    select: {
      id: true,
      userId: true,
      reason: true,
      createdAt: true,
      expiresAt: true,
      reportId: true,
      user: { select: { displayName: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  return rows.map(({ user, createdBy, ...row }) => ({
    ...row,
    userName: user.displayName,
    createdByName: createdBy?.displayName ?? null,
  }));
}

/** The account with this display name (case and accents ignored), or null. */
export async function findUserByName(
  db: AdminDb,
  rawName: string,
): Promise<{ id: string; displayName: string; role: UserRole } | null> {
  const name = normalizeDisplayName(rawName);
  const size = length(name);
  if (size < DISPLAY_NAME_MIN || size > DISPLAY_NAME_MAX) return null;
  const user = await db.user.findUnique({
    where: { displayNameKey: nameKey(name) },
    select: { id: true, displayName: true, role: true },
  });
  if (!user || user.displayName === null) return null;
  return { id: user.id, displayName: user.displayName, role: user.role };
}
