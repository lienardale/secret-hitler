/**
 * Home page and room entry: create, join by code, invite links, errors. FR and EN.
 */
import { expect, test } from "@playwright/test";

import { TEXT, createRoom, newPlayer, type Locale } from "./helpers";

for (const locale of ["fr", "en"] as Locale[]) {
  test.describe(`home (${locale})`, () => {
    test("creates a private room and shows its invite link", async ({ browser }) => {
      const { context, page } = await newPlayer(browser);
      const code = await createRoom(page, locale, "Ada");
      await expect(page.getByText(`/r/${code}`)).toBeVisible();
      await expect(page.getByTestId("room")).toHaveAttribute("data-room-status", "lobby");
      await context.close();
    });

    test("refuses an invalid name and an unknown code", async ({ browser }) => {
      const { context, page } = await newPlayer(browser);
      await page.goto(`/${locale}`);
      await page.getByLabel(TEXT[locale].name).fill("Admin");
      await page.getByRole("button", { name: TEXT[locale].create }).click();
      await expect(
        page.getByText(locale === "fr" ? "Ce nom est réservé" : "This name is reserved"),
      ).toBeVisible();

      const code = page.getByLabel(locale === "fr" ? "Code de la salle" : "Room code");
      await code.fill("ZZZZZ");
      await page
        .getByRole("button", { name: locale === "fr" ? "Rejoindre" : "Join", exact: true })
        .click();
      await expect(
        page.getByText(locale === "fr" ? "Aucune salle avec ce code" : "No room with this code"),
      ).toBeVisible();
      await context.close();
    });

    test("joins an existing room by code", async ({ browser }) => {
      const host = await newPlayer(browser);
      const code = await createRoom(host.page, locale, "Ada");
      const guest = await newPlayer(browser);
      await guest.page.goto(`/${locale}`);
      await guest.page
        .getByLabel(locale === "fr" ? "Code de la salle" : "Room code")
        .fill(code.toLowerCase());
      await guest.page
        .getByRole("button", { name: locale === "fr" ? "Rejoindre" : "Join", exact: true })
        .click();
      await guest.page.waitForURL(new RegExp(`/${code}$`));
      await guest.page.getByLabel(TEXT[locale].name).fill("Basile");
      await guest.page.getByRole("button", { name: TEXT[locale].enter }).click();
      await expect(host.page.getByText("Basile", { exact: true })).toBeVisible();
      await host.context.close();
      await guest.context.close();
    });
  });
}

test("an invite link for a room that does not exist shows the not-found page", async ({
  browser,
}) => {
  const { context, page } = await newPlayer(browser);
  const response = await page.goto("/r/ZZZZZ");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Salle introuvable" })).toBeVisible();
  await context.close();
});

test("the ticket route refuses cross-site requests and visitors without a name", async ({
  request,
  baseURL,
}) => {
  const foreign = await request.post("/api/rooms/BCDFG/ticket", {
    headers: { origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  const anonymous = await request.post("/api/rooms/BCDFG/ticket", {
    headers: { origin: new URL(baseURL as string).origin },
  });
  expect(anonymous.status()).toBe(401);
});
