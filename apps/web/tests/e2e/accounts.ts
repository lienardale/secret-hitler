/**
 * Accounts for the e2e tests, created straight in the `_test` database (the
 * one the Playwright web server uses), and browsers signed in by minting the
 * same session cookie the app issues (lib/auth/session-token.ts), so tests
 * skip the sign-in form unless the form is what they test.
 *
 * Local servers only: against a deployed site (PLAYWRIGHT_BASE_URL) there is
 * no database or secret to reach, and the specs sign up through the UI.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";

import { mintSessionToken, SESSION_COOKIE_NAME } from "../../lib/auth/session-token";
import { assertTestDatabaseUrl, resolveTestEnv, webRoot } from "../_db/test-db";
import { newPlayer } from "./helpers";

// Playwright loads helpers as CommonJS (no import.meta): resolve from the working directory.
const WEB_ROOT = webRoot();
export const MAIL_SINK = join(WEB_ROOT, ".mail/e2e-outbox.jsonl");
export const PASSWORD = "four random winter tables";

/** The website's AUTH_SECRET: the shell's, else apps/web/.env.local (written by dev:setup). */
function authSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = join(WEB_ROOT, ".env.local");
  const secret = existsSync(file) ? parseDotenv(readFileSync(file)).AUTH_SECRET : undefined;
  if (!secret) throw new Error("AUTH_SECRET missing: run `npm run dev:setup`.");
  return secret;
}

export function testDatabaseUrl(): string {
  return assertTestDatabaseUrl(resolveTestEnv().POSTGRES_URL);
}

export async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A name nobody else has, across parallel workers and runs (display names are unique). */
export function uniqueName(prefix: string): string {
  return `${prefix}${randomBytes(5).toString("hex")}`.slice(0, 20);
}

export interface TestAccount {
  id: string;
  email: string;
  displayName: string | null;
}

/** An account with a password (PASSWORD); onboarded and verified unless told otherwise. */
export async function createAccount(
  options: { displayName?: string | null; verified?: boolean; onboarded?: boolean } = {},
): Promise<TestAccount> {
  const id = randomUUID();
  const email = `e2e-${id.slice(0, 8)}@example.test`;
  const onboarded = options.onboarded ?? true;
  const displayName = onboarded ? (options.displayName ?? uniqueName("P")) : null;
  const key = displayName?.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() ?? null;
  await withDb((db) =>
    db.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "displayNameKey", "ageConfirmedAt", "emailVerified", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        id,
        email,
        bcrypt.hashSync(PASSWORD, 4),
        displayName,
        key,
        onboarded ? new Date() : null,
        (options.verified ?? true) ? new Date() : null,
      ],
    ),
  );
  return { id, email, displayName };
}

/** A browser context signed in as `account` (its own IP, like every e2e player). */
export async function signedInPlayer(
  browser: Browser,
  account: TestAccount,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const player = await newPlayer(browser);
  const value = await mintSessionToken(
    { id: account.id, sessionVersion: 0 },
    { secret: authSecret(), cookieName: SESSION_COOKIE_NAME },
  );
  await player.context.addCookies([
    { name: SESSION_COOKIE_NAME, value, url: baseURL, httpOnly: true, sameSite: "Lax" },
  ]);
  return player;
}

/** Mails the log transport wrote for `to` (MAIL_SINK_FILE of the e2e web server). */
export function mailsTo(to: string): { subject: string; text: string }[] {
  if (!existsSync(MAIL_SINK)) return [];
  return readFileSync(MAIL_SINK, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string })
    .filter((mail) => mail.to === to);
}

/** The verification link in the latest mail to `to`, waiting for it to arrive. */
export async function verificationLink(to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const last = mailsTo(to).at(-1);
        link = last?.text.match(/https?:\/\/\S+verif\S+|https?:\/\/\S+verify\S+/)?.[0];
        return link;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return link as string;
}

export function clearMailSink(): void {
  rmSync(MAIL_SINK, { force: true });
}
