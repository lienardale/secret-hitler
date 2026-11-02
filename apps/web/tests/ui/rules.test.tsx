/** The rules page, rendered in both languages, checked against the engine's tables. */
import { POWER_BOARDS, ROLE_TABLE, type PlayerCount } from "@sh/engine";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { RULES_PDF_URL } from "@/lib/legal";
import type { Locale } from "@/lib/i18n/routing";

import enRules from "../../messages/en/rules.json";
import frRules from "../../messages/fr/rules.json";

const CATALOGUES = { fr: { rules: frRules }, en: { rules: enRules } };

// A server component: real translators over the catalogues, a stub header
// (it reads the session) and a plain <a> for the locale-aware Link.
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: "fr" | "en"; namespace: "rules" }) =>
    createTranslator({ locale, messages: CATALOGUES[locale], namespace }),
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

const { default: RulesPage, generateMetadata } = await import("@/app/[locale]/regles/page");

async function renderPage(locale: string) {
  const page = await RulesPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({}),
  } as PageProps<"/[locale]/regles">);
  return render(
    <NextIntlClientProvider locale={locale as Locale} messages={{}}>
      {page}
    </NextIntlClientProvider>,
  );
}

describe.each([
  ["fr", frRules],
  ["en", enRules],
] as const)("rules page (%s)", (locale, messages) => {
  it("has one h1, then sections whose headings never skip a level", async () => {
    const { container } = await renderPage(locale);
    expect(screen.getByRole("heading", { level: 1, name: messages.page.title })).toBeVisible();
    const levels = [...container.querySelectorAll("h1, h2, h3, h4")].map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level).toBeLessThanOrEqual((levels[i - 1] as number) + 1);
    });
    for (const title of [
      messages.goal.title,
      messages.roles.title,
      messages.knowledge.title,
      messages.round.title,
      messages.powers.title,
      messages.veto.title,
      messages.chaos.title,
      messages.reshuffle.title,
      messages.winning.title,
      messages.here.title,
      messages.faq.title,
    ]) {
      expect(screen.getByRole("region", { name: title })).toBeVisible();
    }
  });

  it("links prominently to the official rules PDF", async () => {
    await renderPage(locale);
    const link = screen.getByRole("link", { name: /PDF/ });
    expect(link).toHaveAttribute("href", RULES_PDF_URL);
  });

  it("has a table of contents whose links all reach a section", async () => {
    const { container } = await renderPage(locale);
    const toc = screen.getByRole("navigation", { name: messages.toc.label });
    const links = within(toc).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const link of links) {
      const id = link.getAttribute("href")?.replace(/^#/, "") ?? "";
      expect(container.querySelector(`[id="${id}"]`), id).not.toBeNull();
    }
    expect(container.querySelector("#faq")).not.toBeNull();
    expect(container.querySelector("#playing-here")).not.toBeNull();
  });

  it("shows the role table of the engine, with headers", async () => {
    await renderPage(locale);
    const table = screen.getByRole("table", { name: messages.roles.caption });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    rows.forEach((row, i) => {
      const players = (5 + i) as PlayerCount;
      expect(within(row).getByRole("rowheader")).toHaveTextContent(String(players));
      const cells = within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
      expect(cells).toEqual([
        String(ROLE_TABLE[players].liberal),
        String(ROLE_TABLE[players].fascist),
        "1",
      ]);
    });
  });

  it("shows the power boards of the engine", async () => {
    await renderPage(locale);
    const table = screen.getByRole("table", { name: messages.powers.caption });
    const rows = within(table).getAllByRole("row").slice(1);
    // Five power slots, then the 6th fascist policy wins.
    expect(rows).toHaveLength(6);
    for (let slot = 0; slot < 5; slot++) {
      const cells = within(rows[slot] as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
      expect(cells).toEqual(
        [POWER_BOARDS.small, POWER_BOARDS.medium, POWER_BOARDS.large].map((board) => {
          const power = board[slot];
          return power ? messages.powers.names[power] : messages.powers.none;
        }),
      );
    }
    expect(rows[5]).toHaveTextContent(messages.powers.win);
  });

  it("says Hitler knows the fascists only at 5 or 6 players", async () => {
    await renderPage(locale);
    const faq = screen.getByRole("region", { name: messages.faq.title });
    expect(
      within(faq).getByRole("heading", { level: 3, name: messages.faq.hitlerKnows.q }),
    ).toBeVisible();
    expect(within(faq).getByText(messages.faq.hitlerKnows.a)).toBeVisible();
    const knowledge = screen.getByRole("region", { name: messages.knowledge.title });
    expect(within(knowledge).getByText(messages.knowledge.hitler)).toBeVisible();
  });

  it("answers the FAQ questions the players ask", async () => {
    await renderPage(locale);
    const faq = screen.getByRole("region", { name: messages.faq.title });
    const questions = within(faq).getAllByRole("heading", { level: 3 });
    expect(questions.length).toBeGreaterThanOrEqual(5);
    for (const key of ["votes", "vetoChaos", "lying", "leaving"] as const) {
      expect(within(faq).getByRole("heading", { name: messages.faq[key].q })).toBeVisible();
    }
    // The away rules quote the rooms Worker's real numbers.
    expect(within(faq).getByText(/90/)).toBeVisible();
    expect(within(faq).getAllByText(/3 minutes/).length).toBeGreaterThan(0);
    expect(within(faq).getByText(/15[ -]minute/)).toBeVisible();
  });

  it("links to the list of changes on the credits page and to the code of conduct", async () => {
    await renderPage(locale);
    const here = screen.getByRole("region", { name: messages.here.title });
    expect(within(here).getByRole("link")).toHaveAttribute(
      "href",
      `/${locale}/credits#what-we-changed`,
    );
    const faq = screen.getByRole("region", { name: messages.faq.title });
    expect(within(faq).getByRole("link")).toHaveAttribute(
      "href",
      locale === "fr" ? "/fr/conduite" : "/en/conduct",
    );
  });

  it("has a localised title", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/[locale]/regles">);
    expect(metadata.title).toBe(messages.meta.title);
  });
});

it("refuses an unknown locale", async () => {
  await expect(renderPage("de")).rejects.toThrow("NEXT_NOT_FOUND");
});
