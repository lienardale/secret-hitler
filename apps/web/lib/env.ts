/**
 * Server environment contract. Every variable the website's server code needs
 * is declared here with the rule that matters, and checked on first use, so a
 * missing or malformed value fails with its name instead of deep inside a
 * request. Not evaluated at module scope: `next build` must not need secrets.
 *
 * Local values are written by `npm run dev:setup` into apps/web/.env.local.
 */
import { z } from "zod";

export type EnvSource = Readonly<Record<string, string | undefined>>;

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const httpUrl = z.url().refine((value) => /^https?:\/\//i.test(value), {
  message: "must start with http:// or https://",
});

const secret = z.string().min(32, "must be at least 32 characters");

const flag = z.preprocess(
  (value) => typeof value === "string" && /^(1|true|yes)$/i.test(value.trim()),
  z.boolean(),
);

const schema = z
  .object({
    /** Rooms Worker, as the website's server reaches it (signed calls). */
    ROOMS_URL: httpUrl,
    /** Rooms Worker, as browsers reach it (WebSockets). Defaults to ROOMS_URL. */
    ROOMS_PUBLIC_URL: z.preprocess(blankToUndefined, httpUrl.optional()),
    /** Ed25519 private JWK that signs room tickets. */
    TICKET_PRIVATE_JWK: z.string().refine((value) => value.includes('"d"'), {
      message: "must be a private JWK (run npm run dev:setup locally)",
    }),
    WEB_TO_ROOMS_SECRET: secret,
    /** Checks the rooms Worker's calls (game results), HMAC. */
    ROOMS_TO_WEB_SECRET: secret,
    /** Signs the guest cookie (HS256). */
    GUEST_SECRET: secret,
    /** Auth.js: encrypts session cookies; also salts rate-limit keys. */
    AUTH_SECRET: secret,
    /** Google sign-in: both or neither (the button only shows when set). */
    AUTH_GOOGLE_ID: z.preprocess(blankToUndefined, z.string().optional()),
    AUTH_GOOGLE_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
    /** `log` (dev sink: server log, plus MAIL_SINK_FILE if set) or `resend`. */
    MAIL_TRANSPORT: z.preprocess(blankToUndefined, z.enum(["log", "resend"]).default("log")),
    RESEND_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
    /** Sender, e.g. `Secret Hitler <noreply@example.org>` (a domain verified on Resend). */
    MAIL_FROM: z.preprocess(blankToUndefined, z.string().optional()),
    /** Dev and e2e: the log transport also appends each mail here as a JSON line. */
    MAIL_SINK_FILE: z.preprocess(blankToUndefined, z.string().optional()),
    /** Public play (quick match, public rooms) needs a verified e-mail address. */
    REQUIRE_EMAIL_VERIFICATION: flag,
    /** Vercel Cron's bearer secret for the daily retention cleanup (unset: the route answers 404). */
    CRON_SECRET: z.preprocess(blankToUndefined, z.string().min(32).optional()),
    /** Serves /dev/* test pages. Never set on a deployment. */
    ENABLE_TEST_PAGES: flag,
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.AUTH_GOOGLE_ID) !== Boolean(env.AUTH_GOOGLE_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_GOOGLE_SECRET"],
        message: "set both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or neither",
      });
    }
    if (env.MAIL_TRANSPORT === "resend" && (!env.RESEND_API_KEY || !env.MAIL_FROM)) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "MAIL_TRANSPORT=resend needs RESEND_API_KEY and MAIL_FROM",
      });
    }
  });

export type Env = z.infer<typeof schema> & { ROOMS_PUBLIC_URL: string };

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment:\n  ${issues.join("\n  ")}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: EnvSource): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Names and rules only: never echo a value, it may be a secret.
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return {
    ...result.data,
    ROOMS_PUBLIC_URL: result.data.ROOMS_PUBLIC_URL ?? result.data.ROOMS_URL,
  };
}

let cached: Env | null = null;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test pages are read on their own so a page can 404 without the rest of the contract. */
/**
 * Whether the site talks about e-mail verification at all: only when a mail can
 * actually arrive (Resend) or public play requires it. With the log transport
 * and no requirement (production without a domain), a "resend" button would
 * promise an e-mail that never comes.
 */
export function emailVerificationShown(
  env: Pick<Env, "MAIL_TRANSPORT" | "REQUIRE_EMAIL_VERIFICATION">,
): boolean {
  return env.MAIL_TRANSPORT === "resend" || env.REQUIRE_EMAIL_VERIFICATION;
}

export function testPagesEnabled(source: EnvSource = process.env): boolean {
  return /^(1|true|yes)$/i.test(source.ENABLE_TEST_PAGES?.trim() ?? "");
}
