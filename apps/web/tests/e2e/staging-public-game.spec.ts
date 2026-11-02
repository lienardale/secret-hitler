/**
 * M4's acceptance check against a deployed site (PLAYWRIGHT_BASE_URL only):
 * five accounts signed up through the real form quick-match into one public
 * room, play the game to the end, and each finds it in their profile history.
 * The test accounts are then deleted (which also checks deletion on the site).
 *
 *   PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app \
 *     npx playwright test staging-public-game.spec.ts --project=desktop-chromium
 *
 * Sign-ups are limited to 5 per hour per address: run it at most once an hour.
 * Assumes the site does not require verified e-mails (staging: no domain yet).
 */
import { expect, test, type Page } from "@playwright/test";

import { PASSWORD, uniqueName } from "./accounts";
import { newPlayer, playUntilOver } from "./helpers";
import { hostPage, quickMatch } from "./public";

test.skip(!process.env.PLAYWRIGHT_BASE_URL, "runs against a deployed site only");
test.skip(({ isMobile }) => isMobile, "desktop only");

async function signUp(page: Page, name: string): Promise<void> {
  await page.goto("/fr/inscription");
  await page.getByLabel("Adresse e-mail").fill(`e2e-${name.toLowerCase()}@example.com`);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByLabel("Nom de joueur").fill(name);
  await page.getByLabel("J'ai 15 ans ou plus.").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL(/\/fr$/);
  await expect(page.getByRole("navigation").getByRole("link", { name })).toBeVisible();
}

test("five accounts play a public game and each sees it in their history", async ({ browser }) => {
  test.setTimeout(600_000);
  const names = Array.from({ length: 5 }, () => uniqueName("Stg"));
  const players = await Promise.all(names.map(() => newPlayer(browser)));
  const pages = players.map((p) => p.page);
  for (const [i, page] of pages.entries()) await signUp(page, names[i] as string);

  const code = await quickMatch(pages[0] as Page);
  for (const page of pages.slice(1)) {
    await page.goto("/fr/jouer");
    await expect(page.locator(`[data-testid="lobby-room"][data-code="${code}"]`)).toBeVisible();
    expect(await quickMatch(page)).toBe(code);
  }

  const host = await hostPage(pages);
  await host.getByLabel("Joueurs pour démarrer").selectOption("5");
  for (const page of pages) {
    await expect(page.getByTestId("game-table")).toBeVisible({ timeout: 60_000 });
  }
  await playUntilOver(pages, { seed: 23 });
  for (const page of pages) await expect(page.getByTestId("game-over")).toBeVisible();

  // The result travels room outbox → POST /api/internal/games; give it a minute.
  for (const [i, page] of pages.entries()) {
    await expect
      .poll(
        async () => {
          await page.goto("/fr/profil");
          return page.getByTestId("history-game").filter({ hasText: code }).count();
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBe(1);
    await page.screenshot({
      path: test.info().outputPath(`profile-${i + 1}.png`),
      fullPage: true,
    });
  }

  // Clean up: the test accounts go; the game stays with "Deleted player" seats.
  for (const page of pages) {
    await page.getByRole("button", { name: "Supprimer mon compte…" }).click();
    await page.getByLabel("Votre mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Supprimer définitivement" }).click();
    await page.waitForURL(/\/fr$/);
  }
  for (const player of players) await player.context.close();
});
