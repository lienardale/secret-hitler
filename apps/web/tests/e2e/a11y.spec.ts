/**
 * Accessibility sweep: axe-core (WCAG 2.0 / 2.1, levels A and AA) on every
 * page in French and English, on the desktop and phone projects, plus every
 * /dev/table fixture for a seated player and a spectator. The desktop project
 * also checks the dark colour scheme (the palette tokens flip).
 *
 * Any violation fails the test, with a readable list (rule, impact, page,
 * target selectors). The full results are written next to the test output
 * (`axe.json`).
 *
 * Signed-in, admin and room pages need the local servers and database: they
 * are skipped against a deployed site (PLAYWRIGHT_BASE_URL).
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { FIXTURE_NAMES } from "../../lib/game-fixtures/fixtures";
import { createAccount, signedInPlayer, withDb, type TestAccount } from "./accounts";
import { TEXT, createRoom, newPlayer, type Locale } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const LOCAL = !process.env.PLAYWRIGHT_BASE_URL;
const LOCALES: Locale[] = ["fr", "en"];

type Scheme = "light" | "dark";

interface Finding {
  page: string;
  scheme: Scheme;
  rule: string;
  impact: string;
  help: string;
  nodes: { target: string; html: string; summary: string }[];
}

/** Light everywhere; dark too on the desktop project (colours do not depend on the viewport). */
function schemes(info: TestInfo): Scheme[] {
  return info.project.name === "desktop-chromium" ? ["light", "dark"] : ["light"];
}

/**
 * Runs axe on the current page in each colour scheme and adds the violations
 * to `findings`. `include` limits the scan to a part of the page.
 */
async function scan(
  page: Page,
  label: string,
  findings: Finding[],
  options: { include?: string; exclude?: string[] } = {},
): Promise<void> {
  for (const scheme of schemes(test.info())) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // Let colour transitions (buttons fade over 150 ms) settle before reading contrast.
    await page.waitForTimeout(250);
    let builder = new AxeBuilder({ page }).withTags(TAGS);
    if (options.include) builder = builder.include(options.include);
    // `next dev`'s own overlay, when the sweep runs against a dev server.
    for (const selector of ["nextjs-portal", ...(options.exclude ?? [])]) {
      builder = builder.exclude(selector);
    }
    const result = await builder.analyze();
    for (const violation of result.violations) {
      findings.push({
        page: label,
        scheme,
        rule: violation.id,
        impact: violation.impact ?? "unknown",
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: node.target.map((part) => String(part)).join(" "),
          html: node.html.replace(/\s+/g, " ").slice(0, 160),
          summary: (node.failureSummary ?? "").split("\n").slice(1, 2).join(" ").trim(),
        })),
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

function format(findings: Finding[]): string {
  const lines = [`${findings.length} axe violation(s):`];
  for (const f of findings) {
    lines.push(`• ${f.page} [${f.scheme}] — ${f.rule} (${f.impact}): ${f.help}`);
    for (const node of f.nodes.slice(0, 8)) {
      lines.push(`    ${node.target}`);
      if (node.summary) lines.push(`      ${node.summary}`);
      lines.push(`      ${node.html}`);
    }
    if (f.nodes.length > 8) lines.push(`    … and ${f.nodes.length - 8} more`);
  }
  return lines.join("\n");
}

function expectNoViolations(findings: Finding[]): void {
  writeFileSync(test.info().outputPath("axe.json"), JSON.stringify(findings, null, 2));
  expect(findings.length, format(findings)).toBe(0);
}

/** Opens `path` and returns its HTTP status (agent A's new pages may 404 while being built). */
async function open(page: Page, path: string): Promise<number> {
  const response = await page.goto(path);
  // Let client components hydrate. Bounded: link prefetches can stay open (404 routes).
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
  return response?.status() ?? 0;
}

// ------------------------------------------------------------ static pages ----

const PUBLIC_PAGES: Record<Locale, [string, string][]> = {
  fr: [
    ["home", "/fr"],
    ["play (guest)", "/fr/jouer"],
    ["conduct", "/fr/conduite"],
    ["sign-in", "/fr/connexion"],
    ["sign-up", "/fr/inscription"],
    ["verify-email (no token)", "/fr/verifier-email"],
    ["verify-email (token)", "/fr/verifier-email?token=e2e-a11y-not-a-real-token"],
    ["rules", "/fr/regles"],
    ["credits", "/fr/credits"],
    ["legal notice", "/fr/mentions-legales"],
    ["privacy", "/fr/confidentialite"],
    ["not found", "/fr/page-qui-n-existe-pas"],
  ],
  en: [
    ["home", "/en"],
    ["play (guest)", "/en/play"],
    ["conduct", "/en/conduct"],
    ["sign-in", "/en/sign-in"],
    ["sign-up", "/en/sign-up"],
    ["verify-email (no token)", "/en/verify-email"],
    ["verify-email (token)", "/en/verify-email?token=e2e-a11y-not-a-real-token"],
    ["rules", "/en/rules"],
    ["credits", "/en/credits"],
    ["legal notice", "/en/legal-notice"],
    ["privacy", "/en/privacy"],
    ["not found", "/en/page-that-does-not-exist"],
  ],
};

for (const locale of LOCALES) {
  test(`public pages (${locale})`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await newPlayer(browser);
    const findings: Finding[] = [];
    const missing: string[] = [];
    for (const [name, path] of PUBLIC_PAGES[locale]) {
      const status = await open(page, path);
      if (status === 404 && name !== "not found") missing.push(path);
      await scan(page, `${name} ${path}${status === 404 ? " (404)" : ""}`, findings);
    }
    if (missing.length > 0) {
      test.info().annotations.push({ type: "404", description: missing.join(", ") });
    }

    // The sign-in form after a refusal (error message tied to the form).
    await open(page, locale === "fr" ? "/fr/connexion" : "/en/sign-in");
    const email = locale === "fr" ? "Adresse e-mail" : "E-mail address";
    const password = locale === "fr" ? "Mot de passe" : "Password";
    await page.getByLabel(email).fill("nobody-a11y@example.test");
    await page.getByLabel(password).fill("not the right password at all");
    await page
      .getByRole("main")
      .getByRole("button", { name: locale === "fr" ? "Se connecter" : "Sign in" })
      .click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await scan(page, `sign-in (refused)`, findings);

    // The installable app's offline page (static, no locale).
    await open(page, "/offline.html");
    await scan(page, "offline page /offline.html", findings);

    await context.close();
    expectNoViolations(findings);
  });
}

// -------------------------------------------------------- signed-in pages ----

/** A finished 5-player game in `account`'s history, and one blocked player. */
async function seedProfile(account: TestAccount, blocked: TestAccount): Promise<void> {
  const gameId = randomUUID();
  const endedAt = new Date(Date.now() - 60 * 60_000);
  const startedAt = new Date(endedAt.getTime() - 25 * 60_000);
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO "Game" (id, room, visibility, lang, number, "startedAt", "endedAt", outcome, winner, reason)
       VALUES ($1, 'BCDFG', 'public', 'fr', 1, $2, $3, 'finished', 'liberal', 'liberalPolicies')`,
      [gameId, startedAt, endedAt],
    );
    const roles = ["liberal", "fascist", "liberal", "hitler", "liberal"];
    for (const [seat, role] of roles.entries()) {
      await db.query(
        `INSERT INTO "GamePlayer" ("gameId", seat, kind, "userId", name, role, alive, won)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
        [
          gameId,
          seat,
          seat === 0 ? "user" : "guest",
          seat === 0 ? account.id : null,
          seat === 0 ? account.displayName : `Invité ${seat}`,
          role,
          role === "liberal",
        ],
      );
    }
    await db.query(`INSERT INTO "Block" ("blockerId", "blockedId") VALUES ($1, $2)`, [
      account.id,
      blocked.id,
    ]);
  });
}

for (const locale of LOCALES) {
  test(`signed-in pages (${locale})`, async ({ browser, baseURL }) => {
    test.skip(!LOCAL, "needs the local database");
    test.setTimeout(180_000);
    const base = baseURL as string;
    const [player, other, newcomer, banned] = await Promise.all([
      createAccount(),
      createAccount(),
      createAccount({ onboarded: false }),
      createAccount(),
    ]);
    await seedProfile(player, other);
    await withDb((db) =>
      db.query(
        `INSERT INTO "Ban" ("userId", reason, "expiresAt") VALUES ($1, $2, now() + interval '1 day')`,
        [banned.id, "Insultes répétées dans le chat."],
      ),
    );
    const findings: Finding[] = [];
    const paths =
      locale === "fr"
        ? { play: "/fr/jouer", profile: "/fr/profil" }
        : { play: "/en/play", profile: "/en/profile" };

    const signedIn = await signedInPlayer(browser, player, base);
    await open(signedIn.page, `/${locale}`);
    await scan(signedIn.page, `home (signed in) /${locale}`, findings);
    await open(signedIn.page, paths.play);
    await scan(signedIn.page, `play (signed in) ${paths.play}`, findings);
    await open(signedIn.page, paths.profile);
    await expect(signedIn.page.getByRole("main")).toContainText(other.displayName as string);
    await scan(signedIn.page, `profile ${paths.profile}`, findings);
    await signedIn.context.close();

    const welcome = await signedInPlayer(browser, newcomer, base);
    const welcomePath = locale === "fr" ? "/fr/bienvenue" : "/en/welcome";
    await open(welcome.page, welcomePath);
    await scan(welcome.page, `welcome ${welcomePath}`, findings);
    await welcome.context.close();

    const suspended = await signedInPlayer(browser, banned, base);
    await open(suspended.page, paths.profile);
    await scan(suspended.page, `profile (suspended) ${paths.profile}`, findings);
    await suspended.context.close();

    expectNoViolations(findings);
  });
}

// ------------------------------------------------------------ admin pages ----

/** A report against `target` by `reporter`, with a short transcript, as the room would send it. */
async function seedReport(reporter: TestAccount, target: TestAccount): Promise<string> {
  const id = randomUUID();
  const at = Date.now() - 5 * 60_000;
  const reporterParty = { pid: "p1", kind: "user", sub: reporter.id, name: reporter.displayName };
  const targetParty = { pid: "p2", kind: "user", sub: target.id, name: target.displayName };
  const evidence = {
    status: "lobby",
    game: null,
    members: [
      { ...reporterParty, seat: null, host: true, connected: true },
      { ...targetParty, seat: null, host: false, connected: true },
    ],
    chat: [
      {
        kind: "system",
        id: 1,
        at: at - 60_000,
        key: "playerJoined",
        params: { name: target.displayName },
      },
      {
        kind: "player",
        id: 2,
        at: at - 30_000,
        pid: "p2",
        name: target.displayName,
        text: "vous êtes tous nuls",
      },
      {
        kind: "player",
        id: 3,
        at: at - 20_000,
        pid: "p1",
        name: reporter.displayName,
        text: "on se calme",
      },
    ],
    events: [],
  };
  await withDb((db) =>
    db.query(
      `INSERT INTO "Report" (id, room, "reporterId", "reporterName", "targetId", "targetName", reason, details, evidence, "createdAt")
       VALUES ($1, 'BCDFG', $2, $3, $4, $5, 'harassment', $6, $7, $8)`,
      [
        id,
        reporter.id,
        reporter.displayName,
        target.id,
        target.displayName,
        "Insultes dans le chat.",
        JSON.stringify(evidence),
        new Date(at),
      ],
    ),
  );
  return id;
}

for (const locale of LOCALES) {
  test(`admin pages (${locale})`, async ({ browser, baseURL }) => {
    test.skip(!LOCAL, "needs the local database");
    const [admin, reporter, target, banned] = await Promise.all([
      createAccount(),
      createAccount(),
      createAccount(),
      createAccount(),
    ]);
    await withDb(async (db) => {
      await db.query(`UPDATE "User" SET role = 'ADMIN' WHERE id = $1`, [admin.id]);
      await db.query(
        `INSERT INTO "Ban" ("userId", reason, "createdById", "expiresAt") VALUES ($1, $2, $3, now() + interval '7 days')`,
        [banned.id, "Propos haineux.", admin.id],
      );
    });
    const reportId = await seedReport(reporter, target);
    const findings: Finding[] = [];
    const { context, page } = await signedInPlayer(browser, admin, baseURL as string);
    const paths =
      locale === "fr"
        ? ["/fr/admin/signalements", `/fr/admin/signalements/${reportId}`, "/fr/admin/bannis"]
        : ["/en/admin/reports", `/en/admin/reports/${reportId}`, "/en/admin/bans"];
    for (const path of paths) {
      expect(await open(page, path), path).toBe(200);
      await scan(page, `admin ${path}`, findings);
    }
    await context.close();
    expectNoViolations(findings);
  });
}

// ------------------------------------------------------------------ rooms ----

const ROOM_NAMES = ["Ada", "Basile", "Chloé", "Dimitri", "Elsa"];
const ROOM_TEXT = {
  fr: {
    room: (code: string) => `/fr/salle/${code}`,
    menu: (name: string) => `Actions pour ${name}`,
    report: (name: string) => `Signaler ${name}`,
    hostControls: "Contrôles de l'hôte",
  },
  en: {
    room: (code: string) => `/en/room/${code}`,
    menu: (name: string) => `Actions for ${name}`,
    report: (name: string) => `Report ${name}`,
    hostControls: "Host controls",
  },
} as const;

/** Opens the room in `locale` (the invite link would pick the room's own language) as a guest. */
async function joinAsGuest(page: Page, locale: Locale, code: string, name: string) {
  await page.goto(ROOM_TEXT[locale].room(code));
  await page.getByLabel(TEXT[locale].name).fill(name);
  await page.getByRole("button", { name: TEXT[locale].enter }).click();
  await expect(page.getByTestId("room")).toBeVisible();
}

for (const locale of LOCALES) {
  test(`room: name gate, lobby and game screen (${locale})`, async ({ browser }) => {
    test.skip(!LOCAL, "needs the local rooms Worker");
    test.setTimeout(240_000);
    const players = await Promise.all(ROOM_NAMES.map(() => newPlayer(browser)));
    const [host, guest, ...rest] = players.map((p) => p.page) as [Page, Page, ...Page[]];
    const findings: Finding[] = [];
    const T = ROOM_TEXT[locale];

    const code = await createRoom(host, locale, ROOM_NAMES[0] as string);
    await expect(host.getByTestId("room")).toHaveAttribute("data-room-status", "lobby");
    await scan(host, `room lobby (host, alone) ${host.url()}`, findings);

    // The name gate a guest sees before entering.
    await guest.goto(T.room(code));
    await expect(guest.getByLabel(TEXT[locale].name)).toBeVisible();
    await scan(guest, `room name gate ${guest.url()}`, findings);
    await guest.getByLabel(TEXT[locale].name).fill(ROOM_NAMES[1] as string);
    await guest.getByRole("button", { name: TEXT[locale].enter }).click();
    await expect(guest.getByTestId("room")).toBeVisible();
    for (const [i, page] of rest.entries()) {
      await joinAsGuest(page, locale, code, ROOM_NAMES[i + 2] as string);
    }
    await expect(host.getByRole("button", { name: TEXT[locale].start })).toBeEnabled();
    await scan(host, `room lobby (host, 5 players) ${host.url()}`, findings);
    await scan(guest, `room lobby (guest) ${guest.url()}`, findings);

    // The player menu on another guest (guests can only be muted).
    await guest.getByRole("button", { name: T.menu(ROOM_NAMES[2] as string), exact: true }).click();
    await expect(guest.getByTestId("member-dialog")).toBeVisible();
    await scan(guest, `room player menu (guest) ${guest.url()}`, findings);
    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId("member-dialog")).toBeHidden();

    await host.getByRole("button", { name: TEXT[locale].start }).click();
    for (const page of [host, guest]) await expect(page.getByTestId("game-table")).toBeVisible();
    await host.getByText(T.hostControls, { exact: true }).click();
    await scan(host, `room game (host, controls open) ${host.url()}`, findings);
    await scan(guest, `room game (guest) ${guest.url()}`, findings);

    await Promise.all(players.map((p) => p.context.close()));
    expectNoViolations(findings);
  });

  test(`room: report form between two accounts (${locale})`, async ({ browser, baseURL }) => {
    test.skip(!LOCAL, "needs the local rooms Worker and database");
    const [reporter, target] = await Promise.all([createAccount(), createAccount()]);
    const r = await signedInPlayer(browser, reporter, baseURL as string);
    const t = await signedInPlayer(browser, target, baseURL as string);
    const findings: Finding[] = [];
    const T = ROOM_TEXT[locale];

    await r.page.goto(`/${locale}`);
    await r.page.getByRole("button", { name: TEXT[locale].create }).click();
    await r.page.waitForURL(/\/(salle|room)\/[A-Z]{5}$/);
    const code = r.page.url().slice(-5);
    await t.page.goto(T.room(code));
    await expect(t.page.getByTestId("room")).toBeVisible();

    const name = target.displayName as string;
    await r.page.getByRole("button", { name: T.menu(name), exact: true }).click();
    await expect(r.page.getByTestId("member-dialog")).toBeVisible();
    await scan(r.page, `room player menu (account) ${r.page.url()}`, findings);
    await r.page.getByRole("button", { name: T.report(name), exact: true }).click();
    await expect(r.page.getByRole("radio").first()).toBeVisible();
    await scan(r.page, `room report form ${r.page.url()}`, findings);

    await Promise.all([r.context.close(), t.context.close()]);
    expectNoViolations(findings);
  });
}

// ---------------------------------------------------------- /dev/table ----

/** Fixtures in groups of five: one page per group, several groups in parallel. */
const GROUPS: (typeof FIXTURE_NAMES)[number][][] = [];
for (let i = 0; i < FIXTURE_NAMES.length; i += 5) GROUPS.push(FIXTURE_NAMES.slice(i, i + 5));

for (const locale of LOCALES) {
  for (const viewer of ["player", "spectator"] as const) {
    for (const group of GROUPS) {
      test(`table fixtures ${group[0]}…${group.at(-1)} (${locale}, ${viewer})`, async ({
        page,
      }) => {
        test.setTimeout(240_000);
        const findings: Finding[] = [];
        for (const [index, fixture] of group.entries()) {
          // No seat: the sandbox shows the fixture's acting seat (the decision on screen).
          const seat = viewer === "spectator" ? "&seat=spectator" : "";
          const path = `/${locale}/dev/table?players=7&seed=3&fixture=${fixture}${seat}`;
          await page.goto(path);
          await expect(page.getByTestId("game-table")).toBeVisible();
          // The sandbox's own controls are a dev tool (English, outside the game): only the table.
          await scan(page, `table ${fixture} (${viewer}) ${path}`, findings, {
            include: '[data-testid="game-table"]',
          });
          // Once per group: the role card turned face up (keyboard toggle).
          if (viewer === "player" && index === 0) {
            const card = page.locator(".sh-role button[aria-pressed]").first();
            if ((await card.count()) > 0) {
              await card.focus();
              await page.keyboard.press("Enter");
              await expect(card).toHaveAttribute("aria-pressed", "true");
              await scan(page, `table ${fixture} (role card shown) ${path}`, findings, {
                include: '[data-testid="game-table"]',
              });
            }
          }
        }
        expectNoViolations(findings);
      });
    }
  }
}
