/**
 * Whole private games in real browsers:
 * - five guests, joined through the invite link, play to the end (one of them
 *   reloads mid-game and gets their seat back);
 * - one browser plays with six bots from apps/rooms/scripts/bots.ts.
 * Desktop only: a full game is long, and the layouts are covered elsewhere.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { TEXT, createRoom, joinByInvite, newPlayer, playUntilOver } from "./helpers";

test.skip(({ isMobile }) => isMobile, "full games run on the desktop project only");

const NAMES = ["Ada", "Basile", "Chloé", "Dimitri", "Elsa"];

test("five guests play a private game from a shared link", async ({ browser }) => {
  const players = await Promise.all(NAMES.map(() => newPlayer(browser)));
  const pages = players.map((p) => p.page);
  const [host, ...others] = pages as [Page, ...Page[]];

  const code = await createRoom(host, "fr", NAMES[0] as string);
  for (const [i, page] of others.entries())
    await joinByInvite(page, "fr", code, NAMES[i + 1] as string);
  for (const page of pages) await expect(page.getByTestId("room")).toBeVisible();

  const start = host.getByRole("button", { name: TEXT.fr.start });
  await expect(start).toBeEnabled();
  await start.click();
  for (const page of pages) await expect(page.getByTestId("game-table")).toBeVisible();

  // A few moves in, one player reloads: same seat, game still going.
  await playUntilOver(pages, { seed: 3, maxClicks: 6 }).catch(() => undefined);
  const reloading = pages[2] as Page;
  const seatBefore = await reloading
    .locator('[data-testid="seat"][data-you="true"]')
    .getAttribute("data-seat");
  await reloading.reload();
  await expect(reloading.getByTestId("game-table")).toBeVisible();
  if (seatBefore !== null) {
    await expect(reloading.locator('[data-testid="seat"][data-you="true"]')).toHaveAttribute(
      "data-seat",
      seatBefore,
    );
  }

  await playUntilOver(pages, { seed: 5 });
  for (const page of pages) {
    await expect(page.getByTestId("game-over")).toBeVisible();
    await expect(page.getByTestId("room")).toHaveAttribute("data-room-status", "ended");
  }
  const winners = await Promise.all(
    pages.map((p) => p.getByTestId("game-over").getAttribute("data-winner")),
  );
  expect(new Set(winners).size).toBe(1);

  // Rematch: back to the lobby with the same players.
  await host.getByRole("button", { name: "Revanche" }).click();
  for (const page of pages)
    await expect(page.getByTestId("room")).toHaveAttribute("data-room-status", "lobby");
  await Promise.all(players.map((p) => p.context.close()));
});

test("one browser plays with six bots", async ({ browser }) => {
  const { context, page } = await newPlayer(browser);
  const code = await createRoom(page, "en", "Ada");

  // testDir is apps/web/tests/e2e; the bots script runs from the repository root.
  const repo = join(test.info().config.rootDir, "../../../..");
  const bots = spawn(
    "npx",
    [
      "tsx",
      "apps/rooms/scripts/bots.ts",
      "--room",
      code,
      "--players",
      "6",
      "--think",
      "60",
      "--timeout",
      "170",
      // The rooms Worker the e2e servers use (PLAYWRIGHT_ROOMS_PORT, see playwright.config.ts).
      "--url",
      `http://localhost:${process.env.PLAYWRIGHT_ROOMS_PORT ?? 8787}`,
    ],
    { cwd: repo, stdio: "pipe" },
  );
  let output = "";
  bots.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  bots.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const botsDone = new Promise<number>((resolve) => bots.on("exit", (code) => resolve(code ?? 1)));

  try {
    const start = page.getByRole("button", { name: TEXT.en.start });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    await expect(page.getByTestId("game-table")).toBeVisible();
    await playUntilOver([page], { seed: 11 });
    await expect(page.getByTestId("room")).toHaveAttribute("data-room-status", "ended");
    expect(await botsDone, output).toBe(0);
  } finally {
    bots.kill();
    await context.close();
  }
});
