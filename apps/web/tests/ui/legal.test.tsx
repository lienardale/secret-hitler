/** The legal notice and the privacy policy, in both languages. */
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONTACT_EMAIL } from "@/lib/contact";
import { HOSTS, LEGAL_UPDATED, type Publisher } from "@/lib/legal";
import type { Locale } from "@/lib/i18n/routing";

import enLegal from "../../messages/en/legal.json";
import frLegal from "../../messages/fr/legal.json";

const CATALOGUES = { fr: { legal: frLegal }, en: { legal: enLegal } };

// The publisher lib/legal.ts declares; a test may swap in the named shape.
const publisher = vi.hoisted(() => ({ value: null as Publisher | null }));

vi.mock("@/lib/legal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal")>();
  return {
    ...actual,
    get PUBLISHER() {
      return publisher.value ?? actual.PUBLISHER;
    },
  };
});
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: "fr" | "en"; namespace: "legal" }) =>
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
  }: { href: string | { pathname: string }; children?: React.ReactNode } & Record<
    string,
    unknown
  >) {
    const locale = useLocale();
    const pathname = typeof href === "string" ? href : href.pathname;
    const entry = paths[pathname];
    const localized = typeof entry === "string" ? entry : (entry?.[locale] ?? pathname);
    return (
      <a href={`/${locale}${localized === "/" ? "" : localized}`} {...rest}>
        {children}
      </a>
    );
  }
  return { Link };
});

const notice = await import("@/app/[locale]/mentions-legales/page");
const privacy = await import("@/app/[locale]/confidentialite/page");

async function renderNotice(locale: string) {
  const page = await notice.default({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({}),
  } as PageProps<"/[locale]/mentions-legales">);
  return render(
    <NextIntlClientProvider locale={locale as Locale} messages={{}}>
      {page}
    </NextIntlClientProvider>,
  );
}

async function renderPrivacy(locale: string) {
  const page = await privacy.default({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({}),
  } as PageProps<"/[locale]/confidentialite">);
  return render(
    <NextIntlClientProvider locale={locale as Locale} messages={{}}>
      {page}
    </NextIntlClientProvider>,
  );
}

/** Testing Library matches text with whitespace collapsed: French no-break spaces become spaces. */
function plain(text: string): string {
  return text.replace(/\s+/g, " ");
}

function headingLevels(container: HTMLElement): number[] {
  return [...container.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1]));
}

function expectHeadingsInOrder(container: HTMLElement) {
  const levels = headingLevels(container);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  levels.forEach((level, i) => {
    if (i > 0) expect(level).toBeLessThanOrEqual((levels[i - 1] as number) + 1);
  });
}

beforeEach(() => {
  publisher.value = null;
});

describe.each([
  ["fr", frLegal],
  ["en", enLegal],
] as const)("legal notice (%s)", (locale, messages) => {
  it("names the anonymous non-professional publisher and the host that has their identity", async () => {
    const { container } = await renderNotice(locale);
    expect(
      screen.getByRole("heading", { level: 1, name: messages.notice.page.title }),
    ).toBeVisible();
    expectHeadingsInOrder(container);
    const section = screen.getByRole("region", { name: messages.notice.publisher.title });
    expect(section).toHaveTextContent("6-III-2");
    expect(section).toHaveTextContent("Vercel Inc.");
    expect(
      within(section).getByText(plain(messages.notice.publisher.directorAnonymous)),
    ).toBeVisible();
    expect(within(section).getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute(
      "href",
      `mailto:${CONTACT_EMAIL}`,
    );
  });

  it("lists every host with its legal name and postal address", async () => {
    await renderNotice(locale);
    const section = screen.getByRole("region", { name: messages.notice.hosts.title });
    for (const host of HOSTS) {
      const block = within(section)
        .getByRole("heading", { level: 3, name: new RegExp(`^${host.service}`) })
        .closest("div") as HTMLElement;
      expect(within(block).getByText(host.company)).toBeVisible();
      for (const line of host.address) expect(within(block).getByText(line)).toBeVisible();
      expect(block).toHaveTextContent(messages.countries.US);
      if (host.phone) expect(block).toHaveTextContent(host.phone);
    }
    expect(section).toHaveTextContent("Databricks, Inc.");
  });

  it("shows when it was last updated", async () => {
    const { container } = await renderNotice(locale);
    expect(container.querySelector(`time[datetime="${LEGAL_UPDATED}"]`)).toHaveTextContent(
      locale === "fr" ? "3 novembre 2026" : "November 3, 2026",
    );
  });

  it("links the credits, the code of conduct and the privacy policy", async () => {
    await renderNotice(locale);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining(
        locale === "fr"
          ? ["/fr/credits", "/fr/conduite", "/fr/confidentialite"]
          : ["/en/credits", "/en/conduct", "/en/privacy"],
      ),
    );
  });

  it("names a named publisher and the publication director when lib/legal.ts says so", async () => {
    publisher.value = {
      kind: "named",
      name: "Ada Lovelace",
      address: ["1 rue de l'Exemple", "75000 Paris"],
      director: "Ada Lovelace",
      phone: "+33 1 23 45 67 89",
    };
    await renderNotice(locale);
    const section = screen.getByRole("region", { name: messages.notice.publisher.title });
    expect(section).toHaveTextContent("Ada Lovelace");
    expect(section).toHaveTextContent("1 rue de l'Exemple");
    expect(section).toHaveTextContent("+33 1 23 45 67 89");
    expect(section).not.toHaveTextContent("6-III-2");
  });

  it("has a localised title", async () => {
    const metadata = await notice.generateMetadata({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/[locale]/mentions-legales">);
    expect(metadata.title).toBe(messages.notice.meta.title);
  });
});

describe.each([
  ["fr", frLegal],
  ["en", enLegal],
] as const)("privacy policy (%s)", (locale, messages) => {
  const p = messages.privacy;

  it("has every section, headings in order", async () => {
    const { container } = await renderPrivacy(locale);
    expect(screen.getByRole("heading", { level: 1, name: p.page.title })).toBeVisible();
    expectHeadingsInOrder(container);
    for (const title of [
      p.summary.title,
      p.controller.title,
      p.data.title,
      p.bases.title,
      p.hosting.title,
      p.retention.title,
      p.cookies.title,
      p.rights.title,
      p.age.title,
      p.changes.title,
    ]) {
      expect(screen.getByRole("region", { name: title })).toBeVisible();
    }
    expect(container.querySelector(`time[datetime="${LEGAL_UPDATED}"]`)).not.toBeNull();
  });

  it("lists the essential cookies and says there is no tracking", async () => {
    await renderPrivacy(locale);
    const cookies = screen.getByRole("region", { name: p.cookies.title });
    expect(within(cookies).getByText(plain(p.cookies.lead))).toBeVisible();
    for (const name of ["sh_guest", "authjs.session-token", "NEXT_LOCALE", "authjs.csrf-token"]) {
      expect(within(cookies).getByText(name)).toBeVisible();
    }
  });

  it("has a retention table with headers and the cleanup's periods", async () => {
    await renderPrivacy(locale);
    const table = screen.getByRole("table", { name: p.retention.caption });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    const rows = within(table).getAllByRole("rowheader");
    expect(rows).toHaveLength(Object.keys(p.retention.rows).length);
    // The periods of lib/retention/cleanup.ts (RETENTION_MS), as the page states them.
    const periods =
      locale === "fr"
        ? {
            games: /12\s*mois/,
            reports: /6\s*mois.*12\s*mois/,
            moderation: /2\s*ans/,
            limits: /Un jour/,
          }
        : {
            games: /12 months/,
            reports: /6 months.*12 months/,
            moderation: /2 years/,
            limits: /One day/,
          };
    for (const [key, period] of Object.entries(periods) as [keyof typeof periods, RegExp][]) {
      expect(p.retention.rows[key].howLong).toMatch(period);
      expect(within(table).getByText(plain(p.retention.rows[key].howLong))).toBeVisible();
    }
    expect(p.retention.rows.barred.howLong).not.toBe("");
  });

  it("names the hosting regions and the age rule", async () => {
    await renderPrivacy(locale);
    const hosting = screen.getByRole("region", { name: p.hosting.title });
    expect(hosting).toHaveTextContent("cdg1");
    expect(hosting).toHaveTextContent("fra1");
    expect(screen.getByRole("region", { name: p.age.title })).toHaveTextContent("15");
  });

  it("explains the rights, self-service deletion, the contact and the CNIL", async () => {
    await renderPrivacy(locale);
    const rights = screen.getByRole("region", { name: p.rights.title });
    expect(within(rights).getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute(
      "href",
      `mailto:${CONTACT_EMAIL}`,
    );
    expect(within(rights).getByRole("link", { name: /cnil\.fr/ })).toHaveAttribute(
      "href",
      "https://www.cnil.fr/fr/plaintes",
    );
    const profile = locale === "fr" ? "/fr/profil" : "/en/profile";
    expect(
      within(rights)
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === profile),
    ).toBe(true);
  });

  it("has a localised title", async () => {
    const metadata = await privacy.generateMetadata({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/[locale]/confidentialite">);
    expect(metadata.title).toBe(p.meta.title);
  });
});

it("both pages refuse an unknown locale", async () => {
  await expect(renderNotice("de")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(renderPrivacy("de")).rejects.toThrow("NEXT_NOT_FOUND");
});
