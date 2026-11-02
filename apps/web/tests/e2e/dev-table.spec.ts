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
