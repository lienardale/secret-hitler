/**
 * Deleting a suspended account must not lift the suspension: the account's
 * e-mail address is kept as a keyed fingerprint (`BarredEmail`, never the
 * address itself) until the suspension ends, and sign-up (form or Google)
 * refuses that address meanwhile. The daily cleanup deletes fingerprints whose
 * `until` has passed (lib/retention/cleanup.ts).
 *
 * The key is AUTH_SECRET, like the rate-limit fingerprints: rotating it forgets
 * every barred address (fails open, never locks anyone out by mistake).
 */
import { createHash } from "node:crypto";

import { normalizeEmail } from "@/lib/auth/email";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import { activeBan } from "./bans";

/** `sha256(AUTH_SECRET:barred-email:address)`, hex (64 characters, the column's width). */
export function barredEmailFingerprint(email: string): string {
  const material = [process.env.AUTH_SECRET ?? "", "barred-email", normalizeEmail(email)].join(":");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * When the bar on `userId`'s address should end if the account is deleted now:
 * `{ until }` (null = permanent) while a suspension runs, else null.
 */
export async function barringEnd(
  db: Pick<PrismaClient, "ban">,
  userId: string,
  now: Date = new Date(),
): Promise<{ until: Date | null } | null> {
  const ban = await activeBan(db, userId, now);
  return ban ? { until: ban.expiresAt } : null;
}

/**
 * The query that bars `email` until `until`, for the transaction that deletes
 * the account. A plain function on purpose: a Prisma query is lazy, but an
 * async function returning one would run it at once, outside the transaction.
 */
export function barEmailStatement(
  db: Pick<PrismaClient, "barredEmail">,
  email: string,
  until: Date | null,
): Prisma.PrismaPromise<{ fingerprint: string }> {
  const fingerprint = barredEmailFingerprint(email);
  return db.barredEmail.upsert({
    where: { fingerprint },
    create: { fingerprint, until },
    // The same address barred again later (re-created after an earlier bar ended): the new end wins.
    update: { until },
    select: { fingerprint: true },
  });
}

/** Whether `email` belongs to an account deleted while suspended, and that suspension still runs. */
export async function isEmailBarred(
  db: Pick<PrismaClient, "barredEmail">,
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await db.barredEmail.findUnique({
    where: { fingerprint: barredEmailFingerprint(email) },
    select: { until: true },
  });
  return row !== null && (row.until === null || row.until > now);
}
