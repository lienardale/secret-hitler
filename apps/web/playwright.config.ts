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

const CI = Boolean(process.env.CI);
const WEB_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const ROOMS_PORT = 8787;
/** Set to test a deployed site (e.g. staging) instead of local servers. */
const EXTERNAL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
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
          command: `npm -w @sh/rooms run dev -- --port ${ROOMS_PORT} --inspector-port 0`,
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
          env: { ROOMS_URL: `http://localhost:${ROOMS_PORT}`, ENABLE_TEST_PAGES: "1" },
        },
      ],
});
