/**
 * Sign-in failures and how they reach a form (from velo-atelier).
 *
 * `signIn("credentials")` from a server action throws an `AuthError`; for
 * credentials it is a `CredentialsSignin` whose `code` is what `authorize`
 * threw, possibly wrapped in `error.cause.err`. Everything becomes one of two
 * outcomes: `invalid` (unknown e-mail and wrong password say exactly the same
 * thing: no account enumeration) or `rate_limited` with a wait.
 *
 * `@auth/core/errors`, not `next-auth`: the latter's barrel imports
 * `next/server` and cannot load in a plain Node test. `instanceof` still
 * matches: next-auth re-exports these classes.
 */
import { CredentialsSignin } from "@auth/core/errors";

export const RATE_LIMITED_CODE = "rate_limited";

export class RateLimitedSignin extends CredentialsSignin {
  override code = RATE_LIMITED_CODE;
  readonly retryAfterSec: number;

  constructor(retryAfterMs: number) {
    super("Too many sign-in attempts");
    this.retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

export type SignInFailure = { kind: "invalid" } | { kind: "rate_limited"; retryAfterSec: number };

function* errorChain(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    yield current;
    current = (current as { cause?: { err?: unknown } }).cause?.err;
  }
}

/** What a thrown sign-in error means, or null when it is not one (rethrow it). */
export function signInFailure(error: unknown): SignInFailure | null {
  for (const link of errorChain(error)) {
    if (link instanceof RateLimitedSignin) {
      return { kind: "rate_limited", retryAfterSec: link.retryAfterSec };
    }
    if ((link as { code?: unknown }).code === RATE_LIMITED_CODE) {
      const retry = (link as { retryAfterSec?: unknown }).retryAfterSec;
      return { kind: "rate_limited", retryAfterSec: typeof retry === "number" ? retry : 60 };
    }
    if (link instanceof CredentialsSignin) return { kind: "invalid" };
    if ((link as { type?: unknown }).type === "CredentialsSignin") return { kind: "invalid" };
  }
  return null;
}

/**
 * `?error=` values Auth.js puts on its error page (our sign-in page), as
 * `auth.errors.*` message keys. Anything unknown is the generic one.
 */
const AUTH_ERROR_KEYS: Readonly<Record<string, string>> = {
  CredentialsSignin: "invalidCredentials",
  OAuthAccountNotLinked: "oauthAccountNotLinked",
  AccessDenied: "accessDenied",
  OAuthCallbackError: "oauthFailed",
  OAuthSignInError: "oauthFailed",
  Configuration: "authFailed",
  Verification: "authFailed",
};

export function authErrorKey(error: string | undefined | null): string | null {
  if (!error) return null;
  return Object.hasOwn(AUTH_ERROR_KEYS, error) ? (AUTH_ERROR_KEYS[error] as string) : "authFailed";
}
