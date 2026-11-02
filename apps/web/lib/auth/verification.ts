/**
 * E-mail verification links: a random 32-byte token in the link, only its
 * SHA-256 in the database, valid 24 hours, single use. A new link replaces
 * the previous one.
 *
 * The link opens a page with a button (a POST), not a GET that consumes the
 * token: mail scanners prefetch links and would otherwise burn it.
 */
import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@/lib/generated/prisma/client";

export const VERIFICATION_TTL_MS = 24 * 60 * 60_000;

export type VerificationStore = Pick<PrismaClient, "emailToken" | "user" | "$transaction">;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A fresh link token for `userId` (the previous ones stop working). */
export async function createVerificationToken(
  db: VerificationStore,
  userId: string,
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.emailToken.deleteMany({ where: { userId, purpose: "VERIFY_EMAIL" } }),
    db.emailToken.create({
      data: {
        userId,
        purpose: "VERIFY_EMAIL",
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
      },
    }),
  ]);
  return token;
}

/** Marks the address verified and burns the token. The user id, or null (unknown, used or expired). */
export async function consumeVerificationToken(
  db: VerificationStore,
  token: string,
  now = new Date(),
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const row = await db.emailToken.findUnique({
    where: { tokenHash },
    select: { userId: true, purpose: true, expiresAt: true },
  });
  if (!row || row.purpose !== "VERIFY_EMAIL") return null;
  // Deleting by hash is what makes it single-use under a race: only one delete finds the row.
  const deleted = await db.emailToken.deleteMany({ where: { tokenHash } });
  if (deleted.count === 0 || row.expiresAt.getTime() <= now.getTime()) return null;
  await db.user.update({ where: { id: row.userId }, data: { emailVerified: now } });
  return row.userId;
}
