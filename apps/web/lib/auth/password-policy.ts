/**
 * The password policy, checked on the server at sign-up (whatever the browser did).
 *
 * NIST SP 800-63B style: a length floor, bcrypt's 72-byte ceiling, and the
 * 10 000 most common passwords refused (vendored from SecLists via
 * velo-atelier). No composition rules. Returns `auth.password.*` message keys.
 *
 * Plain Node (no `server-only`) so the seed can use it, but the common list
 * makes it heavy: never import it from client components.
 */
import { isCommonPassword } from "./common-passwords";
import { MAX_PASSWORD_BYTES, passwordByteLength } from "./password";

export const PASSWORD_MIN_LENGTH = 10;

export type PasswordProblem = "tooShort" | "tooLong" | "tooCommon" | "matchesEmail";

export function checkPassword(
  password: string,
  context: { email?: string } = {},
): PasswordProblem | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) return "tooShort";
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) return "tooLong";
  if (isCommonPassword(password)) return "tooCommon";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) return "matchesEmail";
  return null;
}
