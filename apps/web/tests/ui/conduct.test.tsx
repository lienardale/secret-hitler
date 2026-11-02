/** The code of conduct page, rendered in both languages. */
import { render, screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { CONTACT_EMAIL } from "@/lib/contact";

import enConduct from "../../messages/en/conduct.json";
import frConduct from "../../messages/fr/conduct.json";

const CATALOGUES = { fr: { conduct: frConduct }, en: { conduct: enConduct } };

// The page is a server component: give it real translators over the
// catalogues, and stub the header (it reads the session).
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: "fr" | "en"; namespace: "conduct" }) =>
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

const { default: ConductPage, generateMetadata } = await import("@/app/[locale]/conduite/page");

async function renderPage(locale: string) {
  const page = await ConductPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({}),
  } as PageProps<"/[locale]/conduite">);
  return render(page);
}

describe.each([
  ["fr", frConduct],
  ["en", enConduct],
] as const)("code of conduct (%s)", (locale, messages) => {
  it("renders every section", async () => {
    await renderPage(locale);
    expect(screen.getByRole("heading", { level: 1, name: messages.page.title })).toBeVisible();
    for (const section of ["expected", "tools", "moderators", "contact"] as const) {
      expect(screen.getByRole("region", { name: messages[section].title })).toBeVisible();
    }
    const tools = screen.getByRole("region", { name: messages.tools.title });
    expect(within(tools).getAllByRole("listitem")).toHaveLength(4);
    expect(within(tools).getByText(/100/)).toBeVisible();
  });

  it("links to the contact address", async () => {
    await renderPage(locale);
    const link = screen.getByRole("link", { name: CONTACT_EMAIL });
    expect(link).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  });

  it("has a localised title", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/[locale]/conduite">);
    expect(metadata.title).toBe(messages.meta.title);
  });
});

it("refuses an unknown locale", async () => {
  await expect(renderPage("de")).rejects.toThrow("NEXT_NOT_FOUND");
});
