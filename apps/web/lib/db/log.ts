/**
 * Which Prisma `error` log events are noise (from velo-atelier, where the full
 * investigation is recorded).
 *
 * Prisma logs an error where it THROWS, before any `catch` can see it. The
 * rate limiter (lib/security/db-rate-limit.ts) counts a hit with a conditional
 * `UPDATE` that is expected to match nothing on a fresh or expired key (P2025):
 * that is the limiter deciding, not failing. So the client's errors are taken
 * as events and this listener drops exactly that one line, matched on the
 * target AND on the engine's own sentence (the last non-empty line of the
 * message: outside production the message starts with our source lines, which
 * must never be what matches).
 *
 * The same goes for unique violations the code catches and answers: a display
 * name or e-mail already taken at sign-up / onboarding / rename, and a game
 * result delivered twice at once (the second insert loses the race on
 * `Game_pkey` and is answered "duplicate"). Each is matched on its call site
 * AND its constraint name.
 *
 * Deliberately not "ignore P2025" or "ignore P2002": any other model, call
 * site, constraint or error still prints.
 * `event.message` can contain a call's arguments, so never forward these lines
 * unredacted to a third-party sink.
 */

export interface PrismaErrorLogEvent {
  readonly message: string;
  /** `<model>.<method>`, e.g. `rateLimit.update`. */
  readonly target: string;
}

const EXPECTED_NOT_FOUND: ReadonlySet<string> = new Set(["rateLimit.update"]);
const NOT_FOUND_MESSAGE = /required but not found/;

function engineSentence(message: string): string {
  const text = message.trimEnd();
  return text.slice(text.lastIndexOf("\n") + 1);
}

export function isExpectedNotFoundLog(event: PrismaErrorLogEvent): boolean {
  return (
    EXPECTED_NOT_FOUND.has(event.target) && NOT_FOUND_MESSAGE.test(engineSentence(event.message))
  );
}

/** Call site → the unique constraints its caller catches and answers. */
const EXPECTED_UNIQUE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["user.create", new Set(["User_email_key", "User_displayName_key", "User_displayNameKey_key"])],
  ["user.update", new Set(["User_displayName_key", "User_displayNameKey_key"])],
  ["game.create", new Set(["Game_pkey"])],
]);
const UNIQUE_MESSAGE = /^Unique constraint failed on the (?:constraint|fields): `([^`]+)`/;

export function isExpectedUniqueLog(event: PrismaErrorLogEvent): boolean {
  const allowed = EXPECTED_UNIQUE.get(event.target);
  const constraint = UNIQUE_MESSAGE.exec(engineSentence(event.message).trim())?.[1];
  return allowed !== undefined && constraint !== undefined && allowed.has(constraint);
}

export const PRISMA_LOG_PREFIX = "[prisma]";

/** The whole body of the client's `error` listener: print, unless it is the expected miss. */
export function reportPrismaError(
  event: PrismaErrorLogEvent,
  log: (line: string) => void = console.error,
): void {
  if (isExpectedNotFoundLog(event) || isExpectedUniqueLog(event)) return;
  log(`${PRISMA_LOG_PREFIX} ${event.target}: ${event.message}`);
}
