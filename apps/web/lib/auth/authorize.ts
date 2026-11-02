/**
 * The Credentials provider's `authorize` (from velo-atelier). Everything it
 * touches arrives as a dependency, so tests drive every path with fakes.
 *
 * Three buckets:
 *   `login:<ip>`           10 / 15 min   a scripted run from one address
 *   `login:<ip>:<email>`    5 / 15 min   a targeted guess from one address
 *   `login-email:<email>`  50 / h SOFT   a distributed run, only DELAYED: a hard
 *                                        limit would let anyone lock a victim out
 *
 * The per-IP buckets are skipped for the `local` sentinel outside production
 * (no proxy header: a developer on `next dev`). The e2e suite runs `next start`
 * (production) and sends its own `x-real-ip` per test instead.
 *
 * An unknown e-mail and a Google-only account both run a real bcrypt compare
 * against a dummy hash, so every failure costs the same time and says the same thing.
 */
import {
  allowAllRateLimiter,
  DB_RATE_LIMITS,
  rateLimitKey,
  SOFT_DELAY_MS,
  type DbRateLimiter,
} from "@/lib/security/db-rate-limit";
import { LOCAL_CLIENT } from "@/lib/security/client-ip";

import { normalizeEmail } from "./email";
import { RateLimitedSignin } from "./errors";
import { hashPassword, needsRehash, verifyPassword } from "./password";

/** What `authorize` hands to the `jwt` callback. */
export interface AuthorizedUser {
  id: string;
  email: string;
  sessionVersion: number;
}

export interface CredentialsUserStore {
  user: {
    findUnique(args: {
      where: { email: string };
      select: { id: true; email: true; sessionVersion: true; passwordHash: true };
    }): PromiseLike<{
      id: string;
      email: string;
      sessionVersion: number;
      passwordHash: string | null;
    } | null>;
    update(args: { where: { id: string }; data: { passwordHash: string } }): PromiseLike<unknown>;
  };
}

export interface AuthorizeDeps {
  prisma: CredentialsUserStore;
  rateLimiter: DbRateLimiter;
  ip: string;
  isProduction: boolean;
  sleep?: (ms: number) => Promise<void>;
  verify?: typeof verifyPassword;
  hash?: typeof hashPassword;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readCredentials(credentials: unknown): { email: string; password: string } | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const { email, password } = credentials as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") return null;
  if (email.length === 0 || email.length > 254 || password.length === 0) return null;
  return { email, password };
}

/**
 * The user on success, null on any failure (Auth.js reports `CredentialsSignin`).
 * Throws `RateLimitedSignin` for a full bucket, the one failure that says more.
 */
export async function authorizeCredentials(
  credentials: unknown,
  deps: AuthorizeDeps,
): Promise<AuthorizedUser | null> {
  const parsed = readCredentials(credentials);
  if (!parsed) return null;
  const email = normalizeEmail(parsed.email);
  const {
    prisma,
    rateLimiter,
    ip,
    isProduction,
    sleep = defaultSleep,
    verify = verifyPassword,
    hash = hashPassword,
  } = deps;

  const ipLimiter = ip === LOCAL_CLIENT && !isProduction ? allowAllRateLimiter : rateLimiter;
  const ipEmailKey = rateLimitKey("login", ip, email);
  const [byIp, byIpEmail] = await Promise.all([
    ipLimiter.consume(rateLimitKey("login", ip), DB_RATE_LIMITS.loginPerIp),
    ipLimiter.consume(ipEmailKey, DB_RATE_LIMITS.loginPerIpEmail),
  ]);
  if (!byIp.ok || !byIpEmail.ok) {
    throw new RateLimitedSignin(Math.max(byIp.retryAfterMs, byIpEmail.retryAfterMs));
  }
  const byEmail = await rateLimiter.consume(
    rateLimitKey("login-email", email),
    DB_RATE_LIMITS.loginPerEmail,
  );
  if (!byEmail.ok) await sleep(SOFT_DELAY_MS);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, sessionVersion: true, passwordHash: true },
  });
  const valid = await verify(parsed.password, user?.passwordHash ?? null);
  if (!user || !valid) return null;

  // Clears the (address, account) bucket only: resetting the per-address one
  // would let an address guess without limit by signing in to its own account.
  await ipLimiter.reset(ipEmailKey);
  if (user.passwordHash && needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(parsed.password) },
    });
  }
  return { id: user.id, email: user.email, sessionVersion: user.sessionVersion };
}
