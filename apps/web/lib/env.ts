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

const schema = z.object({
  /** Rooms Worker, as the website's server reaches it (signed calls). */
  ROOMS_URL: httpUrl,
  /** Rooms Worker, as browsers reach it (WebSockets). Defaults to ROOMS_URL. */
  ROOMS_PUBLIC_URL: z.preprocess(blankToUndefined, httpUrl.optional()),
  /** Ed25519 private JWK that signs room tickets. */
  TICKET_PRIVATE_JWK: z.string().refine((value) => value.includes('"d"'), {
    message: "must be a private JWK (run npm run dev:setup locally)",
  }),
  WEB_TO_ROOMS_SECRET: secret,
  /** Signs the guest cookie (HS256). */
  GUEST_SECRET: secret,
  /** Serves /dev/* test pages. Never set on a deployment. */
  ENABLE_TEST_PAGES: z.preprocess(
    (value) => typeof value === "string" && /^(1|true|yes)$/i.test(value.trim()),
    z.boolean(),
  ),
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
export function testPagesEnabled(source: EnvSource = process.env): boolean {
  return /^(1|true|yes)$/i.test(source.ENABLE_TEST_PAGES?.trim() ?? "");
}
