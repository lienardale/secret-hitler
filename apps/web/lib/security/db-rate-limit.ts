/**
 * Rate limits on the `RateLimit` table (velo-atelier's limiter): they hold
 * across serverless instances, unlike `memoryRateLimiter`. Used where abuse
 * matters (sign-in, sign-up, e-mails, quick match).
 *
 * Fixed window with a reset: a key's first hit stamps `windowStart`, hits
 * inside `windowMs` increment `count`, the first hit after the window reopens
 * it. Every count change is ONE conditional `UPDATE` that returns the row it
 * wrote, so concurrent requests serialise on the row lock and each gets its own
 * position (a read-then-write let a burst of N cost one unit). A fresh or
 * expired key makes the `UPDATE`s miss on purpose (P2025): lib/db/log.ts keeps
 * that expected miss out of the logs.
 *
 * Keys are salted SHA-256 digests (`rateLimitKey`): the table holds no address
 * and no e-mail.
 */
import { createHash } from "node:crypto";

import { isNotFoundError, isUniqueViolation } from "@/lib/db/errors";
import type { PrismaClient } from "@/lib/generated/prisma/client";

export interface RateLimitOptions {
  /** Hits allowed inside one window: the `max`-th passes, the next does not. */
  max: number;
  windowMs: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** How long until this key is accepted again; 0 when `ok`. */
  retryAfterMs: number;
  /** Hits recorded in the current window, this one included. */
  count: number;
}

export interface DbRateLimiter {
  consume(key: string, options: RateLimitOptions): Promise<RateLimitVerdict>;
  /** Forget a key (a successful sign-in clears its (address, account) bucket). */
  reset(key: string): Promise<void>;
}

export type RateLimitStore = Pick<PrismaClient, "rateLimit">;

/**
 * `sha256(AUTH_SECRET:scope:parts…)`, hex: 64 characters, the column's width.
 * Parts are lower-cased; a missing part is an empty segment.
 */
export function rateLimitKey(scope: string, ...parts: readonly (string | undefined)[]): string {
  const material = [
    process.env.AUTH_SECRET ?? "",
    scope,
    ...parts.map((part) => (part ?? "").toLowerCase()),
  ].join(":");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function createDbRateLimiter(
  db: RateLimitStore,
  now: () => number = Date.now,
): DbRateLimiter {
  return {
    async consume(key, { max, windowMs }) {
      const at = new Date(now());
      const windowFloor = new Date(at.getTime() - windowMs);
      const returned = { count: true, windowStart: true, lockedUntil: true } as const;

      const orNull = async <T>(statement: Promise<T>): Promise<T | null> => {
        try {
          return await statement;
        } catch (error) {
          if (isNotFoundError(error)) return null;
          throw error;
        }
      };
      const bump = () =>
        orNull(
          db.rateLimit.update({
            where: { key, windowStart: { gt: windowFloor } },
            data: { count: { increment: 1 } },
            select: returned,
          }),
        );
      const reopen = () =>
        orNull(
          db.rateLimit.update({
            where: { key, windowStart: { lte: windowFloor } },
            data: { count: 1, windowStart: at, lockedUntil: null },
            select: returned,
          }),
        );

      let row = (await bump()) ?? (await reopen());
      if (!row) {
        try {
          row = await db.rateLimit.create({
            data: { key, count: 1, windowStart: at, lockedUntil: null },
            select: returned,
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          // Created by a concurrent request between the statements: count inside it.
          row = (await bump()) ?? (await reopen());
        }
      }
      if (!row) return { ok: true, retryAfterMs: 0, count: 1 }; // reset() ran concurrently

      const windowEnds = row.windowStart.getTime() + windowMs;
      const refused = row.count > max;
      if (refused && row.lockedUntil?.getTime() !== windowEnds) {
        await db.rateLimit.updateMany({
          where: { key },
          data: { lockedUntil: new Date(windowEnds) },
        });
      }
      return {
        ok: !refused,
        retryAfterMs: refused ? Math.max(0, windowEnds - at.getTime()) : 0,
        count: row.count,
      };
    },

    async reset(key) {
      await db.rateLimit.deleteMany({ where: { key } });
    },
  };
}

/** Allows everything: the per-IP buckets for the `local` sentinel outside production. */
export const allowAllRateLimiter: DbRateLimiter = {
  consume: async () => ({ ok: true, retryAfterMs: 0, count: 0 }),
  reset: async () => undefined,
};

/** The database-backed buckets, in one place so tests can assert them. */
export const DB_RATE_LIMITS = {
  /** Per address: a scripted credential-stuffing run stops here. */
  loginPerIp: { max: 10, windowMs: 15 * 60_000 },
  /** Per address and account: a targeted guessing run stops sooner. */
  loginPerIpEmail: { max: 5, windowMs: 15 * 60_000 },
  /** Per account across addresses: SOFT (only delays), or anyone could lock a victim out. */
  loginPerEmail: { max: 50, windowMs: 60 * 60_000 },
  signupPerIp: { max: 5, windowMs: 60 * 60_000 },
  /** Verification e-mails, per account. */
  verifyEmailPerUser: { max: 5, windowMs: 60 * 60_000 },
  /** Quick-match calls, per account (each may create a room). */
  quickMatchPerUser: { max: 20, windowMs: 10 * 60_000 },
  /** Password confirmations to delete an account, per account. */
  deleteAccountPerUser: { max: 5, windowMs: 15 * 60_000 },
  /** Display-name lookups to block someone, per account. */
  blockLookupPerUser: { max: 30, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitOptions>;

/** How long a request that tripped a soft bucket is held. */
export const SOFT_DELAY_MS = 2_000;
