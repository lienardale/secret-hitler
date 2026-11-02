/**
 * Content pages (M6): rules, credits, legal notice, privacy policy. Each one
 * loads in French and English with its title, the footer of every page reaches
 * them, the language switch stays on the same page, and nothing is logged as
 * an error. Runs on both projects (desktop and Pixel 7).
 */
import { expect, test, type Page } from "@playwright/test";

import enCommon from "../../messages/en/common.json";
import enCredits from "../../messages/en/credits.json";
import enLegal from "../../messages/en/legal.json";
import enRules from "../../messages/en/rules.json";
import frCommon from "../../messages/fr/common.json";
import frCredits from "../../messages/fr/credits.json";
import frLegal from "../../messages/fr/legal.json";
import frRules from "../../messages/fr/rules.json";

type Locale = "fr" | "en";

const PAGES: Record<Locale, { path: string; h1: string; footer: string }[]> = {
  fr: [
    { path: "/fr/regles", h1: frRules.page.title, footer: frCommon.footer.rules },
    { path: "/fr/credits", h1: frCredits.page.title, footer: frCommon.footer.credits },
    {
      path: "/fr/mentions-legales",
      h1: frLegal.notice.page.title,
      footer: frCommon.footer.legal,
    },
    {
      path: "/fr/confidentialite",
      h1: frLegal.privacy.page.title,
      footer: frCommon.footer.privacy,
    },
  ],
  en: [
    { path: "/en/rules", h1: enRules.page.title, footer: enCommon.footer.rules },
    { path: "/en/credits", h1: enCredits.page.title, footer: enCommon.footer.credits },
    { path: "/en/legal-notice", h1: enLegal.notice.page.title, footer: enCommon.footer.legal },
    { path: "/en/privacy", h1: enLegal.privacy.page.title, footer: enCommon.footer.privacy },
  ],
};
const COMMON = { fr: frCommon, en: enCommon };

/** Console errors and uncaught exceptions on this page from now on. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function footerNav(page: Page, locale: Locale) {
  return page
    .getByRole("contentinfo")
    .getByRole("navigation", { name: COMMON[locale].footer.label });
}

for (const locale of ["fr", "en"] as const) {
  test.describe(`content pages (${locale})`, () => {
    for (const { path, h1 } of PAGES[locale]) {
      test(`${path} loads with its title, one h1 and no console error`, async ({ page }) => {
        const errors = collectErrors(page);
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page).toHaveTitle(new RegExp(h1));
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        // No horizontal scrolling, phones included.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      });
    }

    test("the footer reaches every content page and the code of conduct", async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/${locale}`);
      for (const { path, h1, footer } of PAGES[locale]) {
        await footerNav(page, locale).getByRole("link", { name: footer, exact: true }).click();
        await expect(page).toHaveURL(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      }
      await footerNav(page, locale)
        .getByRole("link", { name: COMMON[locale].footer.conduct, exact: true })
        .click();
      await expect(page).toHaveURL(locale === "fr" ? "/fr/conduite" : "/en/conduct");
      expect(errors).toEqual([]);
    });

    test("the footer carries the official credit line and the licence", async ({ page }) => {
      await page.goto(PAGES[locale][0]?.path ?? `/${locale}`);
      const footer = page.getByRole("contentinfo");
      await expect(footer).toContainText(
        "Secret Hitler was created by Mike Boxleiter, Tommy Maranges, and Mac Schubert.",
      );
      await expect(footer.getByRole("link", { name: "CC BY-NC-SA 4.0" })).toHaveAttribute(
        "href",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      );
    });

    test("on a short page the footer sits at the bottom of the screen", async ({ page }) => {
      await page.goto(locale === "fr" ? "/fr/connexion" : "/en/sign-in");
      const box = await page.getByRole("contentinfo").boundingBox();
      const viewport = page.viewportSize();
      expect(box && viewport).toBeTruthy();
      if (box && viewport) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        // Either the page fits and the footer ends at the bottom edge, or it scrolls past it.
        expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(
          Math.min(viewport.height, height) - 1,
        );
      }
    });
  });
}

test("the language switch stays on the same content page", async ({ page }) => {
  await page.goto("/fr/regles");
  await page.getByRole("link", { name: frCommon.footer.switchLocale }).click();
  await expect(page).toHaveURL("/en/rules");
  await page.getByRole("link", { name: enCommon.footer.switchLocale }).click();
  await expect(page).toHaveURL("/fr/regles");
  await page.goto("/fr/mentions-legales");
  await page.getByRole("link", { name: frCommon.footer.switchLocale }).click();
  await expect(page).toHaveURL("/en/legal-notice");
  await page.goto("/en/privacy");
  await page.getByRole("link", { name: enCommon.footer.switchLocale }).click();
  await expect(page).toHaveURL("/fr/confidentialite");
});

test("the rules page links to the list of changes on the credits page", async ({ page }) => {
  await page.goto("/fr/regles");
  await page.getByRole("link", { name: frCredits.changed.title }).click();
  await expect(page).toHaveURL("/fr/credits#what-we-changed");
  await expect(
    page.getByRole("heading", { level: 2, name: frCredits.changed.title }),
  ).toBeVisible();
});
