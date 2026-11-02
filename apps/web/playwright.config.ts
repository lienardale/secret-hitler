/**
 * Playwright end-to-end tests: real browsers against a production build of
 * the website (`next start`, :3100) and the rooms Worker (`wrangler dev`, :8787).
 *
 *   npm run dev:setup                 # once: local keys (CI runs it too)
 *   npm -w @sh/web run build          # the CSP's connect-src is baked in at build time,
 *                                     # so build with the ROOMS_URL the tests use (:8787)
 *   npm -w @sh/web run e2e
 *
 * Against a deployed site (only the specs that do not need local servers or keys):
 *   PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app \
 *     npx playwright test private-game.spec.ts -g "five guests" --project=desktop-chromium
 *
 * Locally, servers already running on those ports are reused.
 */
import { defineConfig, devices } from "@playwright/test";

import { resolveTestEnv } from "./tests/_db/test-db";

const CI = Boolean(process.env.CI);
const WEB_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
/**
 * The rooms Worker's port. Another one (PLAYWRIGHT_ROOMS_PORT) lets the e2e run
 * beside a `wrangler dev` already on 8787; build the website with the same
 * ROOMS_URL (the CSP's connect-src is fixed at build time).
 */
const ROOMS_PORT = Number(process.env.PLAYWRIGHT_ROOMS_PORT ?? 8787);
/**
 * Browser origins the e2e rooms Worker accepts: wrangler.jsonc's defaults (the
 * bots script uses :3000) and the website's port, which PLAYWRIGHT_PORT may change.
 */
const ALLOWED_ORIGINS = [
  ...new Set(["http://localhost:3000", "http://localhost:3100", `http://localhost:${WEB_PORT}`]),
].join(",");
/** Set to test a deployed site (e.g. staging) instead of local servers. */
const EXTERNAL = process.env.PLAYWRIGHT_BASE_URL;

// The e2e web server uses the `_test` database (emptied by the global setup)
// and the dev mail sink, and requires verified e-mails for public play.
const testEnv = EXTERNAL ? {} : resolveTestEnv();

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: EXTERNAL ? undefined : "./tests/e2e/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: EXTERNAL ?? `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: EXTERNAL
    ? undefined
    : [
        {
          // Its own local state (apps/rooms/.wrangler/e2e): e2e rooms never mix with dev rooms.
          // ALLOWED_ORIGINS: wrangler.jsonc's list plus the website's port (PLAYWRIGHT_PORT).
          command: `npm -w @sh/rooms run dev -- --port ${ROOMS_PORT} --inspector-port 0 --persist-to .wrangler/e2e --var WEB_API_URL:http://localhost:${WEB_PORT} --var ALLOWED_ORIGINS:${ALLOWED_ORIGINS}`,
          cwd: "../..",
          url: `http://localhost:${ROOMS_PORT}/health`,
          reuseExistingServer: !CI,
          timeout: 120_000,
        },
        {
          command: `npx next start -p ${WEB_PORT}`,
          url: `http://localhost:${WEB_PORT}/fr`,
          reuseExistingServer: !CI,
          timeout: 120_000,
          env: {
            ROOMS_URL: `http://localhost:${ROOMS_PORT}`,
            ENABLE_TEST_PAGES: "1",
            POSTGRES_URL: testEnv.POSTGRES_URL ?? "",
            POSTGRES_URL_NON_POOLING: testEnv.POSTGRES_URL_NON_POOLING ?? "",
            MAIL_TRANSPORT: "log",
            MAIL_SINK_FILE: ".mail/e2e-outbox.jsonl",
            REQUIRE_EMAIL_VERIFICATION: "1",
            AUTH_TRUST_HOST: "true",
          },
        },
      ],
});
