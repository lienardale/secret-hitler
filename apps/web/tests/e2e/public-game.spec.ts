/**
 * Public play in real browsers (local servers):
 * - five accounts quick-match one after the other into the same public room
 *   (the lobby list shows it filling up), the host lowers the start threshold
 *   to 5, the countdown starts the game on its own, they play to the end, and
 *   the result reaches Postgres (rooms outbox → POST /api/internal/games) for
 *   all five accounts;
 * - a visitor without an account sees the room in the lobby but is asked to
 *   sign in at its door;
 * - quick match keeps apart two players when one blocked the other, whichever
 *   of them asks.
 * Desktop only: a full game is long.
 */
import { expect, test, type Page } from "@playwright/test";

import { PASSWORD, createAccount, signedInPlayer, withDb, type TestAccount } from "./accounts";
import { newPlayer, playUntilOver } from "./helpers";
import { hostPage, quickMatch } from "./public";

test.skip(({ isMobile }) => isMobile, "full games run on the desktop project only");
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "needs the local database");

test("five accounts quick-match, play a public game, and the result is stored for each", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  const accounts = await Promise.all(Array.from({ length: 5 }, () => createAccount()));
  const players = await Promise.all(
    accounts.map((account) => signedInPlayer(browser, account, baseURL as string)),
  );
  const pages = players.map((p) => p.page);

  // One after the other, each waiting until the lobby lists the room: quick
  // match then picks it (the fullest waiting room). The room may be one left
  // by an earlier run, with players still inside their 60 s grace: their
  // seats count, so the counts are not asserted exactly.
  const code = await quickMatch(pages[0] as Page);
  for (const page of pages.slice(1)) {
    await page.goto("/fr/jouer");
    await expect(page.locator(`[data-testid="lobby-room"][data-code="${code}"]`)).toBeVisible();
    expect(await quickMatch(page)).toBe(code);
  }

  // A visitor without an account sees the room but cannot sit down.
  const guest = await newPlayer(browser);
  await guest.page.goto("/fr/jouer");
  await expect(guest.page.locator(`[data-code="${code}"]`)).toBeVisible();
  await guest.page.goto(`/fr/salle/${code}`);
  await expect(guest.page.getByText("Les parties publiques demandent un compte")).toBeVisible();
  await expect(
    guest.page.getByRole("main").getByRole("link", { name: "Se connecter" }),
  ).toBeVisible();
  await expect(guest.page.getByTestId("room")).toHaveCount(0);
  await guest.context.close();

  const host = await hostPage(pages);
  await host.getByLabel("Joueurs pour démarrer").selectOption("5");
  await expect(host.getByTestId("start-hint")).toContainText("La partie commence dans");
  for (const page of pages) {
    await expect(page.getByTestId("game-table")).toBeVisible({ timeout: 45_000 });
  }

  await playUntilOver(pages, { seed: 11 });
  for (const page of pages) await expect(page.getByTestId("game-over")).toBeVisible();

  // The room's outbox posts the result; every account gets the game.
  const stored = async () =>
    withDb(async (db) => {
      const { rows } = await db.query<{ userId: string }>(
        `SELECT gp."userId" FROM "GamePlayer" gp JOIN "Game" g ON g.id = gp."gameId"
         WHERE g.room = $1 AND g.visibility = 'public' AND gp."userId" = ANY($2::uuid[])`,
        [code, accounts.map((a) => a.id)],
      );
      return rows.length;
    });
  await expect.poll(stored, { timeout: 60_000, intervals: [1000] }).toBe(5);

  // …and sees it in their profile history.
  const entry = (page: Page) => page.getByTestId("history-game").filter({ hasText: code });
  for (const page of pages) {
    await page.goto("/fr/profil");
    await expect(entry(page)).toBeVisible();
  }

  // One player deletes their account: the game stays in the others' history,
  // with that seat shown as a deleted player.
  const leaver = pages[4] as Page;
  await leaver.getByRole("button", { name: "Supprimer mon compte…" }).click();
  await leaver.getByLabel("Votre mot de passe").fill(PASSWORD);
  await leaver.getByRole("button", { name: "Supprimer définitivement" }).click();
  await leaver.waitForURL(/\/fr$/);
  await expect(
    leaver.getByRole("navigation").getByRole("link", { name: "Connexion" }),
  ).toBeVisible();
  const first = pages[0] as Page;
  await first.reload();
  await expect(entry(first)).toContainText("Joueur supprimé");
  await expect(entry(first)).not.toContainText(accounts[4]?.displayName ?? "-");

  for (const player of players) await player.context.close();
});

test("quick match keeps a player away from someone who blocked them", async ({
  browser,
  baseURL,
}) => {
  const [blocker, blocked] = await Promise.all([createAccount(), createAccount()]);
  await withDb((db) =>
    db.query(`INSERT INTO "Block" ("blockerId", "blockedId") VALUES ($1, $2)`, [
      blocker.id,
      blocked.id,
    ]),
  );
  const open = async (account: TestAccount) => signedInPlayer(browser, account, baseURL as string);
  const first = await open(blocker);
  const code = await quickMatch(first.page, "en");

  const second = await open(blocked);
  await second.page.goto("/en/play");
  await expect(second.page.locator(`[data-code="${code}"]`)).toBeVisible();
  // The blocked player asks: they must not land with the player who blocked them.
  expect(await quickMatch(second.page, "en")).not.toBe(code);

  await first.context.close();
  await second.context.close();
});
