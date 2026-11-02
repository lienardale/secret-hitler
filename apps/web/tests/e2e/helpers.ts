/**
 * Shared steps for the room tests: create a room, join through the invite
 * link, and play a game by clicking random enabled buttons in each player's
 * action panel until every player sees the end.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export type Locale = "fr" | "en";

export const TEXT = {
  fr: {
    name: "Votre nom",
    create: "Créer une salle",
    enter: "Entrer dans la salle",
    start: "Lancer la partie",
  },
  en: {
    name: "Your name",
    create: "Create a room",
    enter: "Enter the room",
    start: "Start the game",
  },
} as const;

/** Each context gets its own IP so per-IP rate limits never collide between tests. */
let ipCounter = Math.floor(Math.random() * 200);
export async function newPlayer(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  ipCounter = (ipCounter % 250) + 1;
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-real-ip": `10.9.${ipCounter}.${Math.floor(Math.random() * 250) + 1}` },
  });
  return { context, page: await context.newPage() };
}

export async function createRoom(page: Page, locale: Locale, name: string): Promise<string> {
  await page.goto(`/${locale}`);
  await page.getByLabel(TEXT[locale].name).fill(name);
  await page.getByRole("button", { name: TEXT[locale].create }).click();
  await page.waitForURL(/\/(salle|room)\/[A-Z]{5}$/);
  const code = page.url().slice(-5);
  await expect(page.getByTestId("room-code")).toHaveText(code);
  return code;
}

/** Opens the short invite link and enters a name on the room's gate. */
export async function joinByInvite(
  page: Page,
  locale: Locale,
  code: string,
  name: string,
): Promise<void> {
  await page.goto(`/r/${code}`);
  await page.waitForURL(new RegExp(`/(salle|room)/${code}$`));
  await page.getByLabel(TEXT[locale].name).fill(name);
  await page.getByRole("button", { name: TEXT[locale].enter }).click();
  await expect(page.getByTestId("room")).toBeVisible();
}

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function gameOver(page: Page): Promise<boolean> {
  return page.getByTestId("game-over").isVisible();
}

/**
 * Plays until every page shows the game-over block: on each round, every
 * player whose action panel has an enabled button clicks one at random.
 */
export async function playUntilOver(
  pages: Page[],
  options: { seed?: number; maxClicks?: number } = {},
): Promise<number> {
  const rand = seededRandom(options.seed ?? 1);
  const maxClicks = options.maxClicks ?? 1500;
  let clicks = 0;
  while (clicks < maxClicks) {
    const done = await Promise.all(pages.map(gameOver));
    if (done.every(Boolean)) return clicks;
    let acted = false;
    for (const page of pages) {
      const buttons = page.locator('[data-testid="action-panel"] button:enabled');
      const count = await buttons.count();
      if (count === 0) continue;
      try {
        await buttons.nth(Math.floor(rand() * count)).click({ timeout: 2000 });
        clicks += 1;
        acted = true;
      } catch {
        // The panel re-rendered under the click: try again next round.
      }
    }
    if (!acted) await pages[0]?.waitForTimeout(150);
  }
  throw new Error(`game did not end within ${maxClicks} clicks`);
}
