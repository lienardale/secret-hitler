/**
 * M5's acceptance check against a deployed site (PLAYWRIGHT_BASE_URL only): two
 * accounts signed up through the real form share a public room; one reports
 * the other; an admin opens the report and bans the player for a day; the
 * banned player's socket closes on the suspension notice and their next ticket
 * is refused. The two test accounts are then deleted (which removes the ban).
 *
 *   PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app \
 *     npx playwright test staging-moderation.spec.ts --project=desktop-chromium
 *
 * Needs an ADMIN account on that site: STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD
 * in the shell, or in apps/web/.env.staging-e2e.local (gitignored, mode 600). Sign-ups are
 * limited to 5 per hour per address. Assumes e-mail verification is not required (staging).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { parse as parseDotenv } from "dotenv";

import { PASSWORD, uniqueName } from "./accounts";
import { newPlayer } from "./helpers";
import { quickMatch } from "./public";
import {
  banFromReport,
  deleteAccount,
  joinRoomAsAccount,
  moderation as M,
  reportPlayer,
  signInThroughForm,
  signUpThroughForm,
} from "./moderation";

function adminCredentials(): { email: string; password: string } | null {
  const file = join(process.cwd(), ".env.staging-e2e.local");
  const fromFile = existsSync(file) ? parseDotenv(readFileSync(file)) : {};
  const email = process.env.STAGING_ADMIN_EMAIL ?? fromFile.STAGING_ADMIN_EMAIL;
  const password = process.env.STAGING_ADMIN_PASSWORD ?? fromFile.STAGING_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

test.skip(!process.env.PLAYWRIGHT_BASE_URL, "runs against a deployed site only");
test.skip(({ isMobile }) => isMobile, "desktop only");

test("a reported player is banned by an admin: socket closed, ticket refused", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const admin = adminCredentials();
  test.skip(admin === null, "STAGING_ADMIN_EMAIL / STAGING_ADMIN_PASSWORD not set");
  const [reporterName, targetName] = [uniqueName("StgRep"), uniqueName("StgTgt")];
  const r = await newPlayer(browser);
  const t = await newPlayer(browser);
  await signUpThroughForm(r.page, reporterName, PASSWORD);
  await signUpThroughForm(t.page, targetName, PASSWORD);

  // A public room from quick match (limited per account), joined by its link: creating
  // private rooms is limited to 10 per hour per address, and every test browser shares
  // the runner's address behind Vercel.
  const code = await quickMatch(r.page);
  await joinRoomAsAccount(t.page, code);

  await t.page.getByLabel(M.fr.chatLabel).fill("espèce de faggot");
  await t.page.getByRole("button", { name: M.fr.chatSend }).click();
  await expect(t.page.getByText(M.fr.chatOffensive)).toBeVisible();
  // Public rooms have a 2 s slow mode, and the refused message used a slot.
  await t.page.waitForTimeout(2_500);
  const insult = `vous êtes tous des nuls ${Date.now()}`;
  await t.page.getByLabel(M.fr.chatLabel).fill(insult);
  await t.page.getByRole("button", { name: M.fr.chatSend }).click();
  await expect(r.page.getByText(insult)).toBeVisible();

  await reportPlayer(
    r.page,
    targetName,
    "Test automatique (staging) : insultes.",
    test.info().outputPath("report-dialog.png"),
  );

  // The room's outbox delivers the evidence within seconds: poll the admin queue.
  const a = await newPlayer(browser);
  await signInThroughForm(a.page, admin!.email, admin!.password);
  await expect
    .poll(
      async () => {
        await a.page.goto("/fr/admin/signalements");
        return a.page.getByRole("link", { name: M.fr.queueEntry(targetName) }).count();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBeGreaterThan(0);
  await banFromReport(
    a.page,
    targetName,
    insult,
    "Test automatique (staging).",
    test.info().outputPath("admin-report.png"),
  );

  await expect(t.page.getByText(M.fr.suspended)).toBeVisible({ timeout: 15_000 });
  const refused = await t.page.request.post(`/api/rooms/${code}/ticket`, {
    headers: { origin: baseURL as string },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "banned" });
  await t.page.goto("/fr/profil");
  await expect(t.page.getByTestId("suspension-notice")).toContainText("Test automatique");
  await t.page.screenshot({ path: test.info().outputPath("suspension.png"), fullPage: true });
  await expect(r.page.getByText(M.fr.removed(targetName))).toBeVisible();

  // Clean up: both test accounts go (the ban goes with the banned account).
  await deleteAccount(t.page, PASSWORD);
  await deleteAccount(r.page, PASSWORD);
  for (const player of [r, t, a]) await player.context.close();
});
