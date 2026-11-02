/**
 * Accounts in real browsers: sign up, verify the e-mail address (dev mail
 * sink), sign out, sign in (wrong password and unknown address say the same
 * thing), server-side refusals, and onboarding for an account without a name.
 * Local servers only (the database and the mail sink are read directly).
 */
import { expect, test, type Page } from "@playwright/test";

import { PASSWORD, createAccount, signedInPlayer, uniqueName, verificationLink } from "./accounts";
import { newPlayer, type Locale } from "./helpers";

test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "needs the local database and mail sink");

const T = {
  fr: {
    signUp: "/fr/inscription",
    signIn: "/fr/connexion",
    play: "/fr/jouer",
    email: "Adresse e-mail",
    password: "Mot de passe",
    name: "Nom de joueur",
    age: "J'ai 15 ans ou plus.",
    create: "Créer mon compte",
    submitSignIn: "Se connecter",
    signOut: "Se déconnecter",
    headerSignIn: "Connexion",
    verifyNeeded: "Vérifiez votre adresse e-mail pour jouer en public.",
    confirm: "Confirmer mon adresse",
    verified: "Adresse vérifiée",
    quickMatch: "Partie rapide",
    wrong: "Adresse e-mail ou mot de passe incorrect.",
  },
  en: {
    signUp: "/en/sign-up",
    signIn: "/en/sign-in",
    play: "/en/play",
    email: "E-mail address",
    password: "Password",
    name: "Player name",
    age: "I am 15 or older.",
    create: "Create my account",
    submitSignIn: "Sign in",
    signOut: "Sign out",
    headerSignIn: "Sign in",
    verifyNeeded: "Verify your e-mail address to play public games.",
    confirm: "Confirm my address",
    verified: "Address verified",
    quickMatch: "Quick match",
    wrong: "Wrong e-mail address or password.",
  },
} as const;

const header = (page: Page) => page.getByRole("navigation");

async function signIn(page: Page, locale: Locale, email: string, password: string) {
  const t = T[locale];
  await page.goto(t.signIn);
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password).fill(password);
  await page.getByRole("main").getByRole("button", { name: t.submitSignIn }).click();
}

for (const locale of ["fr", "en"] as const) {
  const t = T[locale];

  test(`sign up, verify the address, sign out and back in (${locale})`, async ({ browser }) => {
    const { context, page } = await newPlayer(browser);
    const email = `e2e-${uniqueName("s").toLowerCase()}@example.test`;
    const name = uniqueName("Ada");

    await page.goto(t.signUp);
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password).fill(PASSWORD);
    await page.getByLabel(t.name).fill(name);
    await page.getByLabel(t.age).check();
    await page.getByRole("button", { name: t.create }).click();
    await page.waitForURL(new RegExp(`/${locale}$`));
    await expect(header(page).getByRole("link", { name })).toBeVisible();

    // Public play waits for the address to be verified.
    await page.goto(t.play);
    await expect(page.getByText(t.verifyNeeded)).toBeVisible();
    await expect(page.getByRole("button", { name: t.quickMatch })).toHaveCount(0);

    await page.goto(await verificationLink(email));
    await page.getByRole("button", { name: t.confirm }).click();
    await expect(page.getByText(t.verified)).toBeVisible();
    await page.goto(t.play);
    await expect(page.getByRole("button", { name: t.quickMatch })).toBeVisible();

    await header(page).getByRole("button", { name: t.signOut }).click();
    await expect(header(page).getByRole("link", { name: t.headerSignIn })).toBeVisible();

    // A wrong password and an unknown address get the very same answer.
    await signIn(page, locale, email, "not the password at all");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(t.wrong);
    await signIn(page, locale, `nobody-${email}`, PASSWORD);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(t.wrong);

    await signIn(page, locale, email.toUpperCase(), PASSWORD);
    await page.waitForURL(new RegExp(`/${locale}$`));
    await expect(header(page).getByRole("link", { name })).toBeVisible();
    await context.close();
  });
}

test("sign-up refusals are decided on the server", async ({ browser }) => {
  const t = T.fr;
  const taken = await createAccount();
  const { context, page } = await newPlayer(browser);
  await page.goto(t.signUp);
  // Bypass the browser's own checks: the server must refuse by itself.
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByLabel(t.email).fill("not-an-address");
  await page.getByLabel(t.password).fill("short");
  await page.getByLabel(t.name).fill(taken.displayName?.toUpperCase() ?? "");
  await page.getByRole("button", { name: t.create }).click();
  await expect(page.getByText("Cette adresse e-mail n'est pas valide.")).toBeVisible();
  await expect(page.getByText("Au moins 10 caractères.", { exact: true })).toBeVisible();
  await expect(page.getByText("Il faut avoir 15 ans ou plus pour créer un compte.")).toBeVisible();

  // What was typed survives the refusal (React resets forms after an action).
  await expect(page.getByLabel(t.name)).toHaveValue(taken.displayName?.toUpperCase() ?? "");
  await page.getByLabel(t.email).fill(`e2e-${uniqueName("r").toLowerCase()}@example.test`);
  await page.getByLabel(t.password).fill("1234567890");
  await page.getByLabel(t.age).check();
  await page.getByRole("button", { name: t.create }).click();
  await expect(page.getByText("Ce mot de passe est trop courant")).toBeVisible();

  await page.getByLabel(t.password).fill(PASSWORD);
  await page.getByLabel(t.age).check();
  await page.getByRole("button", { name: t.create }).click();
  await expect(page.getByText("Ce nom est déjà pris.")).toBeVisible();
  await context.close();
});

test("an account without a player name chooses one before anything else", async ({
  browser,
  baseURL,
}) => {
  const account = await createAccount({ onboarded: false });
  const { context, page } = await signedInPlayer(browser, account, baseURL as string);
  await page.goto("/fr/jouer");
  await header(page).getByRole("link", { name: "Terminer mon compte" }).click();
  await page.waitForURL(/\/fr\/bienvenue/);

  const name = uniqueName("Onb");
  await page.getByLabel("Nom de joueur").fill(name);
  await page.getByLabel("J'ai 15 ans ou plus.").check();
  await page.getByRole("button", { name: "Valider" }).click();
  await page.waitForURL(/\/fr$/);
  await expect(header(page).getByRole("link", { name })).toBeVisible();
  await context.close();
});
