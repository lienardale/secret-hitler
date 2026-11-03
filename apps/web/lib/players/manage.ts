/**
 * What an account manages from its profile page: its display name, the
 * players it blocked, and the account itself (deletion).
 *
 * Every function takes the database and the signed-in account's id: callers
 * (app/[locale]/profil/actions.ts) read that id from the session, never from
 * the request. Expected failures come back as `{ ok: false, error }` codes,
 * which the page turns into `profile.errors.*` messages.
 *
 * - Renames: one per 30 days (`RENAME_INTERVAL_MS`); the name chosen at sign-up
 *   or onboarding does not count (`displayNameChangedAt` stays NULL until the
 *   first rename). The 30-day rule is part of the UPDATE's WHERE clause, so
 *   two renames racing each other cannot both pass.
 * - Blocks: by exact display name, compared with `nameKey` (case and accents
 *   ignored). Names are public, so "no player with this name" leaks nothing;
 *   the caller rate-limits the lookups. Blocking twice is harmless. At most
 *   `MAX_BLOCK_KEYS`, the number a room ticket carries.
 * - Deletion: the password (or, for a Google-only account, the display name)
 *   confirms it. One transaction clears the stored name of every seat the
 *   account played (the relation's `onDelete: SetNull` only clears `userId`)
 *   and deletes the user (blocks, OAuth accounts and e-mail tokens cascade).
 *   Other players keep the game, with "Deleted player" in that seat.
 */
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, nameKey, normalizeDisplayName } from "@sh/protocol";

import {
  isDisplayNameTaken,
  nextRenameAt,
  RENAME_INTERVAL_MS,
  validateDisplayName,
} from "@/lib/auth/display-name";
import { verifyPassword } from "@/lib/auth/password";
import { isKnownPrismaError } from "@/lib/db/errors";
import { isUuid } from "@/lib/games/ids";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { barEmailStatement, barringEnd } from "@/lib/moderation/barred-emails";

import { MAX_BLOCK_KEYS } from "./blocks";

export type ManageDb = Pick<
  PrismaClient,
  "user" | "block" | "gamePlayer" | "ban" | "barredEmail" | "$transaction"
>;

// -------------------------------------------------------------- rename ----

export type RenameError =
  | "name_length"
  | "name_characters"
  | "name_reserved"
  | "name_offensive"
  | "nameTaken"
  | "sameName"
  | "renameTooSoon"
  | "accountNotFound";

export type RenameOutcome =
  | { ok: true; name: string }
  | { ok: false; error: "renameTooSoon"; /** When the next rename is allowed. */ nextAt: Date }
  | { ok: false; error: Exclude<RenameError, "renameTooSoon"> };

export async function renameAccount(
  db: ManageDb,
  userId: string,
  rawName: unknown,
  now: Date = new Date(),
): Promise<RenameOutcome> {
  const check = validateDisplayName(rawName);
  if (!check.ok) return { ok: false, error: check.error };
  if (!isUuid(userId)) return { ok: false, error: "accountNotFound" };

  const current = await db.user.findUnique({
    where: { id: userId },
    select: { displayName: true, displayNameChangedAt: true },
  });
  if (!current || current.displayName === null) return { ok: false, error: "accountNotFound" };
  if (current.displayName === check.name) return { ok: false, error: "sameName" };
  const waitUntil = nextRenameAt(current.displayNameChangedAt, now);
  if (waitUntil) return { ok: false, error: "renameTooSoon", nextAt: waitUntil };

  const cutoff = new Date(now.getTime() - RENAME_INTERVAL_MS);
  let count: number;
  try {
    ({ count } = await db.user.updateMany({
      where: {
        id: userId,
        displayName: { not: null },
        OR: [{ displayNameChangedAt: null }, { displayNameChangedAt: { lte: cutoff } }],
      },
      data: { displayName: check.name, displayNameKey: check.key, displayNameChangedAt: now },
    }));
  } catch (error) {
    if (isDisplayNameTaken(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
  if (count === 1) return { ok: true, name: check.name };

  // Another rename won the race (or the account is gone).
  const after = await db.user.findUnique({
    where: { id: userId },
    select: { displayNameChangedAt: true },
  });
  if (!after) return { ok: false, error: "accountNotFound" };
  const nextAt =
    nextRenameAt(after.displayNameChangedAt, now) ?? new Date(now.getTime() + RENAME_INTERVAL_MS);
  return { ok: false, error: "renameTooSoon", nextAt };
}

// -------------------------------------------------------------- blocks ----

export type BlockError = "playerNotFound" | "blockSelf" | "tooManyBlocks";

export type BlockOutcome =
  | { ok: true; /** The blocked player's current display name. */ name: string; already: boolean }
  | { ok: false; error: BlockError };

export interface BlockedPlayer {
  userId: string;
  /** Current display name (null only for an account that never finished onboarding). */
  name: string | null;
  blockedAt: Date;
}

/** Block the account whose display name is `rawName` (case and accents ignored). */
export async function blockByName(
  db: ManageDb,
  userId: string,
  rawName: unknown,
): Promise<BlockOutcome> {
  const name = normalizeDisplayName(typeof rawName === "string" ? rawName : "");
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX)
    return { ok: false, error: "playerNotFound" };
  const target = await db.user.findUnique({
    where: { displayNameKey: nameKey(name) },
    select: { id: true },
  });
  if (!target) return { ok: false, error: "playerNotFound" };
  return blockUser(db, userId, target.id);
}

/** Block an account by id (the "Block" buttons of the game history). */
export async function blockUser(
  db: ManageDb,
  userId: string,
  targetId: string,
): Promise<BlockOutcome> {
  if (!isUuid(userId) || !isUuid(targetId)) return { ok: false, error: "playerNotFound" };
  if (targetId.toLowerCase() === userId.toLowerCase()) return { ok: false, error: "blockSelf" };
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { displayName: true },
  });
  if (!target || target.displayName === null) return { ok: false, error: "playerNotFound" };

  const existing = await db.block.findUnique({
    where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
    select: { createdAt: true },
  });
  if (existing) return { ok: true, name: target.displayName, already: true };
  if ((await db.block.count({ where: { blockerId: userId } })) >= MAX_BLOCK_KEYS) {
    return { ok: false, error: "tooManyBlocks" };
  }

  try {
    const { count } = await db.block.createMany({
      data: [{ blockerId: userId, blockedId: targetId }],
      skipDuplicates: true,
    });
    return { ok: true, name: target.displayName, already: count === 0 };
  } catch (error) {
    // P2003: the target account was deleted in between.
    if (isKnownPrismaError(error) && error.code === "P2003")
      return { ok: false, error: "playerNotFound" };
    throw error;
  }
}

/** True when a block was removed. */
export async function unblock(db: ManageDb, userId: string, blockedId: string): Promise<boolean> {
  if (!isUuid(userId) || !isUuid(blockedId)) return false;
  const { count } = await db.block.deleteMany({ where: { blockerId: userId, blockedId } });
  return count > 0;
}

/** The players this account blocked, newest first, with their current names. */
export async function listBlocked(db: ManageDb, userId: string): Promise<BlockedPlayer[]> {
  if (!isUuid(userId)) return [];
  const rows = await db.block.findMany({
    where: { blockerId: userId },
    orderBy: [{ createdAt: "desc" }, { blockedId: "asc" }],
    take: MAX_BLOCK_KEYS,
    select: { createdAt: true, blocked: { select: { id: true, displayName: true } } },
  });
  return rows.map((row) => ({
    userId: row.blocked.id,
    name: row.blocked.displayName,
    blockedAt: row.createdAt,
  }));
}

// ------------------------------------------------------------ deletion ----

export interface DeleteConfirmation {
  /** Accounts with a password. */
  password?: string;
  /** Google-only accounts: their display name, typed again. */
  displayName?: string;
}

export type DeleteError = "wrongPassword" | "wrongName" | "accountNotFound";

export type DeleteOutcome = { ok: true } | { ok: false; error: DeleteError };

export async function deleteAccount(
  db: ManageDb,
  userId: string,
  confirmation: DeleteConfirmation,
): Promise<DeleteOutcome> {
  if (!isUuid(userId)) return { ok: false, error: "accountNotFound" };
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, displayName: true, email: true },
  });
  if (!user) return { ok: false, error: "accountNotFound" };

  if (user.passwordHash !== null) {
    if (!(await verifyPassword(confirmation.password ?? "", user.passwordHash))) {
      return { ok: false, error: "wrongPassword" };
    }
  } else {
    const typed = normalizeDisplayName(confirmation.displayName ?? "");
    if (user.displayName === null || typed === "" || nameKey(typed) !== nameKey(user.displayName)) {
      return { ok: false, error: "wrongName" };
    }
  }

  // A suspended account keeps its suspension: its address stays barred from
  // signing up until the suspension ends (lib/moderation/barred-emails.ts).
  const bar = await barringEnd(db, userId);
  const [, deleted] = await db.$transaction([
    db.gamePlayer.updateMany({ where: { userId }, data: { name: null } }),
    db.user.deleteMany({ where: { id: userId } }),
    ...(bar ? [barEmailStatement(db, user.email, bar.until)] : []),
  ]);
  return deleted.count === 1 ? { ok: true } : { ok: false, error: "accountNotFound" };
}
