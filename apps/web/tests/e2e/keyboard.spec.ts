/**
 * Keyboard-only play (Tab, Shift+Tab, Enter, Space; no mouse) on the
 * /dev/table sandbox: focus lands on the action heading when a decision
 * starts, a nomination, a vote, a discard and an execution (with its
 * confirmation) can be made, the role card turns with Enter and hides again
 * when focus leaves it, and the live regions for decisions and new log lines
 * exist. Then, in a real room (desktop only): the turn alerts (tab-title
 * prefix, one vibration per decision) and the chat input keeping focus when
 * a turn starts.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { TEXT, createRoom, joinByInvite, newPlayer } from "./helpers";

const TABLE = "/fr/dev/table?players=7&seed=3";
/** The ballots (their names may or may not start with "Voter"). */
const JA = /Ja!/;
const NEIN = /Nein!/;

const panel = (page: Page) => page.getByTestId("action-panel");
const heading = (page: Page) => panel(page).getByRole("heading", { level: 2 });
const status = (page: Page) => page.getByTestId("sandbox-status");

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement).catch(() => false);
}

/** Presses Tab (or Shift+Tab) until `target` has focus. */
async function tabTo(page: Page, target: Locator, { back = false, max = 60 } = {}): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await isFocused(target)) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  await expect(target).toBeFocused();
}

/** The sandbox's "seq" (engine sequence number): it grows with every accepted move. */
async function seq(page: Page): Promise<number> {
  const text = (await status(page).textContent()) ?? "";
  return Number(/seq (\d+)/.exec(text)?.[1] ?? Number.NaN);
}

async function openFixture(page: Page, fixture: string, seat?: number): Promise<void> {
  await page.goto(`${TABLE}&fixture=${fixture}${seat === undefined ? "" : `&seat=${seat}`}`);
  await expect(page.getByTestId("game-table")).toBeVisible();
  // Without a seat, the sandbox shows the fixture's acting seat: focus is on its decision.
  if (seat === undefined) await expect(heading(page)).toBeFocused();
}

test.describe("keyboard on the table", () => {
  test("nominate, then vote, with the keyboard only", async ({ page }) => {
    await openFixture(page, "nominate");
    await expect(heading(page)).toHaveText("Proposez un chancelier");
    const live = panel(page).locator('[aria-live="polite"]').first();
    await expect(live).toHaveText(/À vous/);

    // Pick a player, step back to it with Shift+Tab, then confirm.
    const choices = panel(page).getByRole("group").getByRole("button");
    const first = choices.first();
    await tabTo(page, first);
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-pressed", "true");
    const confirm = panel(page).getByRole("button", { name: /^Proposer / });
    await tabTo(page, confirm);
    await tabTo(page, first, { back: true });
    await tabTo(page, confirm);
    const before = await seq(page);
    await page.keyboard.press("Enter");
    await expect.poll(() => seq(page)).toBeGreaterThan(before);

    // The nomination was announced in the log's live region.
    const logLive = page
      .getByRole("region", { name: "Journal de la partie" })
      .locator("[aria-live]");
    await expect(logLive.filter({ hasText: /propose .+ à la chancellerie/ })).toHaveCount(1);

    // The sandbox follows the next player to act: a voter. Focus moves to the vote.
    await expect(heading(page)).toHaveText("Votez");
    await expect(heading(page)).toBeFocused();
    await expect(live).toHaveText(/votez/i);
    const ja = panel(page).getByRole("button", { name: JA });
    await tabTo(page, ja);
    const beforeVote = await seq(page);
    await page.keyboard.press("Enter");
    await expect.poll(() => seq(page)).toBeGreaterThan(beforeVote);
  });

  test("vote Nein! with Space", async ({ page }) => {
    await openFixture(page, "vote");
    const nein = panel(page).getByRole("button", { name: NEIN });
    await tabTo(page, nein);
    const before = await seq(page);
    await page.keyboard.press("Space");
    await expect.poll(() => seq(page)).toBeGreaterThan(before);
  });

  test("discard a policy with the keyboard", async ({ page }) => {
    await openFixture(page, "presidentDiscard");
    const cards = panel(page).getByRole("group").getByRole("button");
    await tabTo(page, cards.first());
    await page.keyboard.press("Enter");
    await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
    const confirm = panel(page).getByRole("button", { name: /^Défausser / });
    await tabTo(page, confirm);
    const before = await seq(page);
    await page.keyboard.press("Enter");
    await expect.poll(() => seq(page)).toBeGreaterThan(before);
  });

  test("execute a player: the confirmation takes focus, Tab reaches Yes", async ({ page }) => {
    await openFixture(page, "execute");
    const choices = panel(page).getByRole("group").getByRole("button");
    await tabTo(page, choices.first());
    await page.keyboard.press("Enter");
    const confirm = panel(page).getByRole("button", { name: /^Exécuter / });
    await tabTo(page, confirm);
    await page.keyboard.press("Enter");
    const dialog = panel(page).getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
    const yes = dialog.getByRole("button", { name: /^Oui, exécuter / });
    await tabTo(page, yes);
    const before = await seq(page);
    await page.keyboard.press("Enter");
    await expect.poll(() => seq(page)).toBeGreaterThan(before);
  });

  test("the role card turns with Enter and hides when focus leaves", async ({ page }) => {
    await openFixture(page, "start", 0);
    const card = page.getByRole("button", { name: /Maintenez pour voir votre rôle/ }).first();
    await tabTo(page, card);
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Space");
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Tab");
    await expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("a new decision does not take focus from a text field", async ({ page }) => {
    await openFixture(page, "nominate");
    const input = page.getByLabel(/your turn must not steal focus/);
    await tabTo(page, input);
    await page.keyboard.type("on attend");
    const before = await seq(page);
    // Someone else's move, without touching focus: the sandbox's random move, clicked by script.
    await page
      .getByRole("button", { name: "Random move" })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect.poll(() => seq(page)).toBeGreaterThan(before);
    await expect(heading(page)).toHaveText("Votez");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("on attend");
  });
});

// ------------------------------------------------------------- a real room ----

const NAMES = ["Ada", "Basile", "Chloé", "Dimitri", "Elsa"];
const PREFIX = "● À vous · ";

declare global {
  interface Window {
    __vibrations?: unknown[];
  }
}

test.describe("turn alerts in a room", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only (five browsers)");
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "needs the local rooms Worker");

  test("title prefix and vibration per decision; the chat keeps focus", async ({ browser }) => {
    test.setTimeout(180_000);
    const players = await Promise.all(NAMES.map(() => newPlayer(browser)));
    for (const { context } of players) {
      // Record vibrations instead of buzzing (desktop Chrome has the API but no motor).
      await context.addInitScript(() => {
        const calls: unknown[] = [];
        window.__vibrations = calls;
        Object.defineProperty(Navigator.prototype, "vibrate", {
          configurable: true,
          value: (pattern: unknown) => {
            calls.push(pattern);
            return true;
          },
        });
      });
    }
    const pages = players.map((p) => p.page);
    const [host, ...others] = pages as [Page, ...Page[]];
    const code = await createRoom(host, "fr", NAMES[0] as string);
    for (const [i, page] of others.entries()) {
      await joinByInvite(page, "fr", code, NAMES[i + 1] as string);
    }
    const start = host.getByRole("button", { name: TEXT.fr.start });
    await expect(start).toBeEnabled();
    for (const page of pages) await expect(page).not.toHaveTitle(/^●/);
    await start.click();
    for (const page of pages) await expect(page.getByTestId("game-table")).toBeVisible();

    // Exactly one player (the President) has a decision: only their title says so.
    await expect
      .poll(async () => {
        const counts = await Promise.all(pages.map((page) => heading(page).count()));
        return counts.reduce((a, b) => a + b, 0);
      })
      .toBe(1);
    const flags = await Promise.all(pages.map(async (page) => (await heading(page).count()) > 0));
    const president = pages[flags.indexOf(true)] as Page;
    const waiting = pages.filter((page) => page !== president);
    await expect(president).toHaveTitle(new RegExp(`^${PREFIX}Salle ${code}`));
    for (const page of waiting) await expect(page).toHaveTitle(new RegExp(`^Salle ${code}`));
    const vibrations = (page: Page) => page.evaluate(() => window.__vibrations?.length ?? 0);
    expect(await vibrations(president)).toBe(1);

    // A waiting player is typing in the chat when the vote starts.
    const typist = waiting[0] as Page;
    const chat = typist.getByLabel("Message", { exact: true });
    await tabTo(typist, chat);
    await typist.keyboard.type("je réfléchis");

    // The President nominates, keyboard only.
    await expect(heading(president)).toBeFocused();
    await tabTo(president, panel(president).getByRole("group").getByRole("button").first());
    await president.keyboard.press("Space");
    await tabTo(president, panel(president).getByRole("button", { name: /^Proposer / }));
    await president.keyboard.press("Enter");

    // Everyone votes now: every title has the prefix, once.
    for (const page of pages) {
      await expect(heading(page)).toHaveText("Votez");
      await expect(page).toHaveTitle(new RegExp(`^${PREFIX}Salle ${code}`));
    }
    await expect(chat).toBeFocused();
    await expect(chat).toHaveValue("je réfléchis");
    await expect.poll(() => vibrations(president)).toBe(2);
    await expect.poll(() => vibrations(typist)).toBe(1);

    // The typist votes (keyboard): their prefix goes; others voting does not bring it back.
    await tabTo(typist, panel(typist).getByRole("button", { name: JA }), {
      back: true,
    });
    await typist.keyboard.press("Enter");
    await expect(typist).toHaveTitle(new RegExp(`^Salle ${code}`));
    const second = waiting[1] as Page;
    await tabTo(second, panel(second).getByRole("button", { name: NEIN }));
    await second.keyboard.press("Enter");
    await expect(second).toHaveTitle(new RegExp(`^Salle ${code}`));
    await expect(typist).toHaveTitle(new RegExp(`^Salle ${code}`));
    await expect(president).toHaveTitle(new RegExp(`^${PREFIX}Salle ${code}`));
    expect(await vibrations(typist)).toBe(1);
    expect(await vibrations(president)).toBe(2);
    expect(await president.title()).not.toContain(`${PREFIX}${PREFIX}`);

    await Promise.all(players.map((p) => p.context.close()));
  });
});
