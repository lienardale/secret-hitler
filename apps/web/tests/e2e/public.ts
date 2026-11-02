/**
 * Steps shared by the public-play tests (local and staging): quick match from
 * the lobby page, and finding the host among the players' pages.
 */
import { expect, type Page } from "@playwright/test";

export const ROOM_URL = /\/(?:fr\/salle|en\/room)\/([A-Z]{5})$/;

// The two tests may run at once: each uses its own language, so their quick
// matches never meet (quick match only picks rooms in the page's language).
export async function quickMatch(page: Page, locale: "fr" | "en" = "fr"): Promise<string> {
  // A refused ticket shows up as a guest-name form: log it to make that failure obvious.
  page.on("response", (response) => {
    if (response.url().includes("/ticket") && response.status() !== 200) {
      console.warn(`ticket answered ${response.status()} on ${page.url()}`);
    }
  });
  await page.goto(locale === "fr" ? "/fr/jouer" : "/en/play");
  await page
    .getByRole("button", { name: locale === "fr" ? "Partie rapide" : "Quick match" })
    .click();
  await page.waitForURL(ROOM_URL);
  await expect(page.getByTestId("room")).toBeVisible();
  return ROOM_URL.exec(page.url())?.[1] as string;
}

/** The page whose player is host (only the host sees the settings). */
export async function hostPage(pages: Page[]): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of pages) {
          if (await page.getByLabel("Joueurs pour démarrer").isVisible()) {
            found = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 75_000, intervals: [500] },
    )
    .toBe(true);
  return found as Page;
}
