/**
 * Moderation end to end (M5's acceptance check), local servers:
 * - two accounts share a private room; the room refuses a slur in the chat;
 * - one reports the other from the room's player menu; the room builds the
 *   evidence itself and its outbox delivers it to POST /api/internal/reports;
 * - an admin opens the report, reads the transcript and bans the player for a day;
 * - the banned player's open socket closes on the suspension notice, their next
 *   ticket is refused (403 banned), and their profile states the reason.
 * The staging version is staging-moderation.spec.ts.
 */
import { expect, test } from "@playwright/test";

import { createAccount, signedInPlayer, withDb } from "./accounts";
import { joinRoomAsAccount, moderation as M, reportPlayer, banFromReport } from "./moderation";

test.skip(({ isMobile }) => isMobile, "desktop only");
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "needs the local database");

test("a reported player is banned by an admin: socket closed, ticket refused", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const [reporter, target, admin] = await Promise.all([
    createAccount(),
    createAccount(),
    createAccount(),
  ]);
  await withDb((db) => db.query(`UPDATE "User" SET role = 'ADMIN' WHERE id = $1`, [admin.id]));
  const base = baseURL as string;
  const r = await signedInPlayer(browser, reporter, base);
  const t = await signedInPlayer(browser, target, base);

  // The reporter opens a private room; the target joins through the invite link.
  await r.page.goto("/fr");
  await r.page.getByRole("button", { name: M.fr.createRoom }).click();
  await r.page.waitForURL(/\/fr\/salle\/[A-Z]{5}$/);
  const code = r.page.url().slice(-5);
  await joinRoomAsAccount(t.page, code);

  // A slur is refused by the room; an ordinary insult goes through.
  await t.page.getByLabel(M.fr.chatLabel).fill("espèce de faggot");
  await t.page.getByRole("button", { name: M.fr.chatSend }).click();
  await expect(t.page.getByText(M.fr.chatOffensive)).toBeVisible();
  const insult = `vous êtes tous des nuls ${Date.now()}`;
  await t.page.getByLabel(M.fr.chatLabel).fill(insult);
  await t.page.getByRole("button", { name: M.fr.chatSend }).click();
  await expect(r.page.getByText(insult)).toBeVisible();

  // The reporter reports the target from the room.
  await reportPlayer(r.page, target.displayName as string, "Insultes répétées dans le chat.");

  // The room's outbox delivers the evidence; the report is stored with its transcript.
  await expect
    .poll(
      () =>
        withDb(async (db) => {
          const { rows } = await db.query<{ n: string }>(
            `SELECT count(*) AS n FROM "Report" WHERE "targetId" = $1 AND "reporterId" = $2 AND room = $3`,
            [target.id, reporter.id, code],
          );
          return Number(rows[0]?.n ?? 0);
        }),
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(1);

  // The admin opens it, reads the transcript and bans the target for a day.
  const a = await signedInPlayer(browser, admin, base);
  await banFromReport(a.page, target.displayName as string, insult, "Insultes répétées.");

  // The target's open socket closes on the suspension notice…
  await expect(t.page.getByText(M.fr.suspended)).toBeVisible({ timeout: 15_000 });
  // …their next ticket is refused…
  const refused = await t.page.request.post(`/api/rooms/${code}/ticket`, {
    headers: { origin: base },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "banned" });
  // …reloading the room shows the same notice, and the profile gives the reason.
  await t.page.reload();
  await expect(t.page.getByText(M.fr.suspended)).toBeVisible();
  await t.page.goto("/fr/profil");
  await expect(t.page.getByTestId("suspension-notice")).toContainText("Insultes répétées.");

  // The ban and its logged action are stored; the report is closed.
  const stored = await withDb(async (db) => {
    const bans = await db.query(`SELECT 1 FROM "Ban" WHERE "userId" = $1 AND "revokedAt" IS NULL`, [
      target.id,
    ]);
    const actions = await db.query(
      `SELECT 1 FROM "ModerationAction" WHERE "targetId" = $1 AND kind = 'ban' AND "moderatorId" = $2`,
      [target.id, admin.id],
    );
    const report = await db.query<{ status: string }>(
      `SELECT status FROM "Report" WHERE "targetId" = $1`,
      [target.id],
    );
    return { bans: bans.rowCount, actions: actions.rowCount, status: report.rows[0]?.status };
  });
  expect(stored).toEqual({ bans: 1, actions: 1, status: "actioned" });

  // The reporter's room carries on: the system message says a moderator removed the player.
  await expect(r.page.getByText(M.fr.removed(target.displayName as string))).toBeVisible();

  for (const player of [r, t, a]) await player.context.close();
});
