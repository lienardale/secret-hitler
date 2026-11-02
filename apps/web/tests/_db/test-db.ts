/**
 * The real test database: the guard, its preparation and emptying (from
 * velo-atelier). Used by the Vitest integration tier (global setup + per file)
 * and the Playwright global setup, which must agree on "which database is this,
 * and may I wipe it".
 *
 * `prisma migrate deploy` + TRUNCATE rather than `migrate reset --force`:
 * Prisma 7.10 refuses `migrate reset` when it detects an AI agent in the
 * environment (CLAUDECODE, CURSOR_AGENT…). The end state is the same.
 *
 * Light on imports (dotenv, pg, node built-ins): Playwright loads this file
 * with its own TypeScript transform, outside Vite.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseDotenv } from "dotenv";
import pg from "pg";

const TEST_DB_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "postgres", "db"]);

export class UnsafeTestDatabaseError extends Error {
  override name = "UnsafeTestDatabaseError";
}

/** Throws unless `url` is a PostgreSQL URL on a local host whose database ends in `_test`. */
export function assertTestDatabaseUrl(url: string | undefined, label = "POSTGRES_URL"): string {
  if (!url) {
    throw new UnsafeTestDatabaseError(`${label} is not set (apps/web/.env.test or the CI env).`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTestDatabaseError(`${label} is not a valid PostgreSQL URL.`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new UnsafeTestDatabaseError(`${label} is not a PostgreSQL URL.`);
  }
  if (!database.endsWith("_test")) {
    throw new UnsafeTestDatabaseError(
      `${label} must name a database ending in _test (got "${database}"): the test tiers empty it.`,
    );
  }
  if (!TEST_DB_HOSTS.has(host)) {
    throw new UnsafeTestDatabaseError(`${label} points at host "${host}", not a local database.`);
  }
  return url;
}

/** apps/web, asserted (the directory holding prisma/schema.prisma). */
export function webRoot(): string {
  const candidates = [process.cwd(), join(process.cwd(), "apps/web")];
  const root = candidates.find((dir) => existsSync(join(dir, "prisma", "schema.prisma")));
  if (!root) throw new Error(`Run the test tiers from apps/web (cwd is "${process.cwd()}").`);
  return root;
}

/** `.env.test`, overridden by the process env (a CI `env:` block wins). A copy. */
export function resolveTestEnv(): Record<string, string> {
  const file = join(webRoot(), ".env.test");
  const merged: Record<string, string> = existsSync(file) ? parseDotenv(readFileSync(file)) : {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (key.startsWith("POSTGRES_") || !(key in merged))) {
      merged[key] = value;
    }
  }
  return merged;
}

/** Puts the test database URLs in `process.env` (from `.env.test` unless the shell set them). */
export function applyTestDatabaseEnv(): { pooled: string; direct: string } {
  const env = resolveTestEnv();
  const pooled = assertTestDatabaseUrl(env.POSTGRES_URL, "POSTGRES_URL");
  const direct = assertTestDatabaseUrl(env.POSTGRES_URL_NON_POOLING, "POSTGRES_URL_NON_POOLING");
  process.env.POSTGRES_URL = pooled;
  process.env.POSTGRES_URL_NON_POOLING = direct;
  return { pooled, direct };
}

/** Empties every application table (keeps `_prisma_migrations`). Guarded. */
export async function emptyTestDatabase(url: string | undefined): Promise<void> {
  const client = new pg.Client({ connectionString: assertTestDatabaseUrl(url) });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length === 0) return;
    const tables = rows.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
    await client.query(`TRUNCATE ${tables.join(", ")} CASCADE`);
  } finally {
    await client.end();
  }
}

async function waitForDatabase(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw new Error(
    `The test database does not answer (${last instanceof Error ? last.message : String(last)}). ` +
      "Start it with `npm -w @sh/web run db:up`.",
  );
}

/** Applies every committed migration to the test database. Guarded. */
export function migrateTestDatabase(direct: string): void {
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: webRoot(),
    env: {
      ...process.env,
      POSTGRES_URL: direct,
      POSTGRES_URL_NON_POOLING: assertTestDatabaseUrl(direct),
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** Once per run: guard, wait, migrate, empty. */
export async function prepareTestDatabase(): Promise<void> {
  const { direct } = applyTestDatabaseEnv();
  await waitForDatabase(direct);
  migrateTestDatabase(direct);
  await emptyTestDatabase(direct);
}
