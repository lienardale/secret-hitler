/** The credits page and the site footer, in both languages. */
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GAME_COPYRIGHT, GAME_CREDIT, LICENSE_URL, RULES_PDF_URL } from "@/lib/legal";
import type { Locale } from "@/lib/i18n/routing";

import enCommon from "../../messages/en/common.json";
import enCredits from "../../messages/en/credits.json";
import frCommon from "../../messages/fr/common.json";
import frCredits from "../../messages/fr/credits.json";

const CATALOGUES = {
  fr: { credits: frCredits, common: frCommon },
  en: { credits: enCredits, common: enCommon },
};

// What lib/legal.ts says about the source code (null until the repo is public).
const source = vi.hoisted(() => ({ url: null as string | null }));

vi.mock("@/lib/legal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/legal")>()),
  get SOURCE_CODE_URL() {
    return source.url;
  },
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({
    locale,
    namespace,
  }: {
    locale: "fr" | "en";
    namespace: "credits" | "common";
  }) => createTranslator({ locale, messages: CATALOGUES[locale], namespace }),
}));
vi.mock("@/components/site/SiteHeader", () => ({
  SiteHeader: () => <header data-testid="site-header" />,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/i18n/navigation", async () => {
  const { useLocale } = await import("next-intl");
  const { routing } = await import("@/lib/i18n/routing");
  const paths = routing.pathnames as Record<string, string | Record<string, string>>;
  function Link({
    href,
    children,
    ...rest
  }: { href: string | { pathname: string; hash?: string }; children?: React.ReactNode } & Record<
    string,
    unknown
  >) {
    const locale = useLocale();
    const pathname = typeof href === "string" ? href : href.pathname;
    const hash = typeof href === "string" || !href.hash ? "" : `#${href.hash}`;
    const entry = paths[pathname];
    const localized = typeof entry === "string" ? entry : (entry?.[locale] ?? pathname);
    return (
      <a href={`/${locale}${localized === "/" ? "" : localized}${hash}`} {...rest}>
        {children}
      </a>
    );
  }
  return { Link };
});

const { default: CreditsPage, generateMetadata } = await import("@/app/[locale]/credits/page");
const { SiteFooter } = await import("@/components/site/SiteFooter");

function withIntl(locale: string, ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale as Locale} messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  );
}

async function renderPage(locale: string) {
  const page = await CreditsPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({}),
  } as PageProps<"/[locale]/credits">);
  return withIntl(locale, page);
}

beforeEach(() => {
  source.url = null;
});

describe.each([
  ["fr", frCredits],
  ["en", enCredits],
] as const)("credits page (%s)", (locale, messages) => {
  it("gives the designers' credit line word for word, in English", async () => {
    await renderPage(locale);
    expect(screen.getByRole("heading", { level: 1, name: messages.page.title })).toBeVisible();
    const credit = screen.getByText(GAME_CREDIT);
    expect(credit).toBeVisible();
    if (locale === "fr") expect(credit).toHaveAttribute("lang", "en");
    else expect(credit).not.toHaveAttribute("lang");
    expect(screen.getByText(GAME_COPYRIGHT)).toBeVisible();
    expect(screen.getByRole("link", { name: messages.game.rules })).toHaveAttribute(
      "href",
      RULES_PDF_URL,
    );
  });

  it("links the licence and says the site is not affiliated nor sold", async () => {
    await renderPage(locale);
    const licence = screen.getByRole("region", { name: messages.license.title });
    expect(within(licence).getByRole("link", { name: /BY-NC-SA 4\.0/ })).toHaveAttribute(
      "href",
      LICENSE_URL,
    );
    expect(within(licence).getByText(messages.license.disclaimer)).toBeVisible();
    expect(screen.getByRole("region", { name: messages.free.title })).toHaveTextContent(
      messages.free.text,
    );
  });

  it("says where the art and fonts come from", async () => {
    await renderPage(locale);
    const art = screen.getByRole("region", { name: messages.art.title });
    expect(within(art).getByText(messages.art.art)).toBeVisible();
    expect(within(art).getByRole("link", { name: "Germania One" })).toBeVisible();
    expect(within(art).getByRole("link", { name: "Jost" })).toBeVisible();
    expect(within(art).getByRole("link", { name: /Open Font License/ })).toBeVisible();
  });

  it("lists every change from the board game under #what-we-changed", async () => {
    const { container } = await renderPage(locale);
    const heading = container.querySelector("#what-we-changed");
    expect(heading).toHaveTextContent(messages.changed.title);
    const section = screen.getByRole("region", { name: messages.changed.title });
    const items = within(section).getAllByRole("listitem");
    const expected = Object.values(messages.changed.items);
    expect(items).toHaveLength(expected.length);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(expected[i]?.title ?? "");
    });
  });

  it("shows no source link while the code is private, and the link once it is set", async () => {
    const first = await renderPage(locale);
    const software = screen.getByRole("region", { name: messages.software.title });
    expect(within(software).getByText(messages.software.noSource)).toBeVisible();
    expect(within(software).queryByRole("link")).toBeNull();
    first.unmount();

    source.url = "https://example.org/secret-hitler";
    await renderPage(locale);
    const again = screen.getByRole("region", { name: messages.software.title });
    expect(within(again).getByRole("link", { name: source.url })).toHaveAttribute(
      "href",
      source.url,
    );
  });

  it("has a localised title", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/[locale]/credits">);
    expect(metadata.title).toBe(messages.meta.title);
  });
});

describe.each([
  [
    "fr",
    frCommon,
    ["/fr/regles", "/fr/credits", "/fr/conduite", "/fr/mentions-legales", "/fr/confidentialite"],
  ],
  ["en", enCommon, ["/en/rules", "/en/credits", "/en/conduct", "/en/legal-notice", "/en/privacy"]],
] as const)("site footer (%s)", (locale, messages, hrefs) => {
  it("links the information pages and carries the credit line and the licence", async () => {
    withIntl(locale, await SiteFooter({ locale }));
    const footer = screen.getByRole("contentinfo");
    const nav = within(footer).getByRole("navigation", { name: messages.footer.label });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(hrefs);
    expect(links.map((link) => link.textContent)).toEqual([
      messages.footer.rules,
      messages.footer.credits,
      messages.footer.conduct,
      messages.footer.legal,
      messages.footer.privacy,
    ]);
    expect(within(footer).getByText(GAME_CREDIT)).toBeVisible();
    expect(footer).toHaveTextContent(GAME_COPYRIGHT);
    expect(within(footer).getByRole("link", { name: "CC BY-NC-SA 4.0" })).toHaveAttribute(
      "href",
      LICENSE_URL,
    );
  });
});

it("refuses an unknown locale", async () => {
  await expect(renderPage("de")).rejects.toThrow("NEXT_NOT_FOUND");
});
