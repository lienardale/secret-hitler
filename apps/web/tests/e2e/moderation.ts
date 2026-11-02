/**
 * Steps shared by the moderation tests (local and staging): join a room as a
 * signed-in account, report a player from the room's player menu, and ban
 * them from the admin's report page. French labels (the default locale).
 */
import { expect, type Page } from "@playwright/test";

export const moderation = {
  fr: {
    createRoom: "Créer une salle",
    chatLabel: "Message",
    chatSend: "Envoyer",
    chatOffensive: "Message refusé : il contient un mot interdit",
    menu: (name: string) => `Actions pour ${name}`,
    report: (name: string) => `Signaler ${name}`,
    reason: "Harcèlement ou insultes",
    details: "Précisions (facultatif)",
    sendReport: "Envoyer le signalement",
    reportSent: "Signalement envoyé : les modérateurs vont l'examiner.",
    queueEntry: (name: string) => `Signalement contre ${name}`,
    banDuration: "Durée",
    banReason: "Motif (montré au joueur)",
    banSubmit: "Bannir",
    banned: (name: string) => `Le compte ${name} est banni jusqu'au`,
    suspended: "Votre compte est suspendu par la modération.",
    removed: (name: string) => `${name} a été retiré de la salle par la modération.`,
  },
} as const;

const M = moderation.fr;

/** Signs up through the real form (deployed sites: no database to seed). */
export async function signUpThroughForm(
  page: Page,
  name: string,
  password: string,
): Promise<string> {
  const email = `e2e-${name.toLowerCase()}@example.com`;
  await page.goto("/fr/inscription");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByLabel("Nom de joueur").fill(name);
  await page.getByLabel("J'ai 15 ans ou plus.").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL(/\/fr$/);
  await expect(page.getByRole("navigation").getByRole("link", { name })).toBeVisible();
  return email;
}

/** Signs in through the real form. */
export async function signInThroughForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("main").getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/fr$/);
}

/** Deletes the signed-in account from its profile (cleanup of deployed-site tests). */
export async function deleteAccount(page: Page, password: string): Promise<void> {
  await page.goto("/fr/profil");
  await page.getByRole("button", { name: "Supprimer mon compte…" }).click();
  await page.getByLabel("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  await page.waitForURL(/\/fr$/);
}

/** Opens the invite link as a signed-in, onboarded account (no name to type). */
export async function joinRoomAsAccount(page: Page, code: string): Promise<void> {
  await page.goto(`/r/${code}`);
  await page.waitForURL(new RegExp(`/fr/salle/${code}$`));
  await expect(page.getByTestId("room")).toBeVisible();
}

/** Reports `name` from the room's player menu and waits for the confirmation. */
export async function reportPlayer(
  page: Page,
  name: string,
  details: string,
  screenshot?: string,
): Promise<void> {
  await page.getByRole("button", { name: M.menu(name), exact: true }).click();
  await page.getByRole("button", { name: M.report(name), exact: true }).click();
  await page.getByRole("radio", { name: M.reason }).check();
  await page.getByLabel(M.details).fill(details);
  if (screenshot) await page.screenshot({ path: screenshot });
  await page.getByRole("button", { name: M.sendReport }).click();
  await expect(page.getByRole("status").filter({ hasText: M.reportSent })).toBeVisible();
}

/**
 * As a moderator: opens the report against `name` from the queue, checks the
 * transcript holds `line`, and bans the player for a day with `reason`.
 */
export async function banFromReport(
  page: Page,
  name: string,
  line: string,
  reason: string,
  screenshot?: string,
): Promise<void> {
  await page.goto("/fr/admin/signalements");
  await page
    .getByRole("link", { name: M.queueEntry(name) })
    .first()
    .click();
  await page.waitForURL(/\/fr\/admin\/signalements\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("transcript")).toContainText(line);
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  const form = page.getByTestId("ban-form");
  await form.getByLabel(M.banDuration).selectOption("1d");
  await form.getByLabel(M.banReason).fill(reason);
  await form.getByRole("button", { name: M.banSubmit, exact: true }).click();
  await expect(page.getByText(M.banned(name))).toBeVisible();
}
