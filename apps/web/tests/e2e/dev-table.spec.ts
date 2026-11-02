/**
 * The /dev/table sandbox (engine running in the page): every fixture renders
 * for a seated player and for a spectator, without console errors, on desktop
 * and on a phone. A cheap guard over every screen of the game table.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE_NAMES } from "../../lib/game-fixtures/fixtures";

for (const fixture of FIXTURE_NAMES) {
  test(`fixture ${fixture} renders for a player and a spectator`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    for (const seat of ["0", "spectator"]) {
      await page.goto(`/fr/dev/table?players=7&seed=3&fixture=${fixture}&seat=${seat}`);
      await expect(page.getByTestId("game-table")).toBeVisible();
      if (seat === "spectator") await expect(page.getByTestId("action-panel")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

/**
 * The team counter reads the engine's role table in the browser: a production
 * minifier once merged two power boards (.debug/004), so check every player
 * count against the official table on the built page.
 */
const TEAMS: Record<number, [liberal: number, fascist: number]> = {
  5: [3, 1],
  6: [4, 1],
  7: [4, 2],
  8: [5, 2],
  9: [5, 3],
  10: [6, 3],
};

test("the team counter matches the role table for every player count", async ({ page }) => {
  for (const [players, [liberal, fascist]] of Object.entries(TEAMS)) {
    await page.goto(`/fr/dev/table?players=${players}&seed=3&fixture=start&seat=spectator`);
    const teams = page.getByTestId("teams");
    await expect(teams).toHaveAttribute("data-liberal", String(liberal));
    await expect(teams).toHaveAttribute("data-fascist", String(fascist));
  }
});
