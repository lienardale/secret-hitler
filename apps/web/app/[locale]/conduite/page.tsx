import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/site/SiteHeader";
import { CONTACT_EMAIL } from "@/lib/contact";
import { routing } from "@/lib/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/conduite">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "conduct" });
  return { title: t("meta.title") };
}

const EXPECTED = [
  "respect",
  "hate",
  "harassment",
  "cheating",
  "sabotage",
  "spam",
  "names",
  "age",
] as const;
const TOOLS = ["mute", "block", "report", "reportWho"] as const;
const MODERATORS = ["rename", "suspend", "accounts"] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="space-y-3 rounded-lg border-2 border-ink bg-paper-raised p-5 shadow-sm"
    >
      <h2 id={id} className="font-display text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The code of conduct: what players may and may not do, the tools they have
 * (mute, block, report), what moderators can do, and where to appeal or send
 * a legal notice (DSA).
 */
export default async function ConductPage({ params }: PageProps<"/[locale]/conduite">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "conduct" });
  const bold = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const mail = (chunks: React.ReactNode) => (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold break-all underline">
      {chunks}
    </a>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} switchHref="/conduite" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
        <header>
          <h1 className="font-display text-5xl tracking-wide">{t("page.title")}</h1>
          <p className="mt-3 text-lg">{t("page.lead")}</p>
        </header>

        <Section id="conduct-expected" title={t("expected.title")}>
          <ul className="list-disc space-y-2 pl-5">
            {EXPECTED.map((key) => (
              <li key={key}>{t(`expected.${key}`)}</li>
            ))}
          </ul>
        </Section>

        <Section id="conduct-tools" title={t("tools.title")}>
          <ul className="list-disc space-y-2 pl-5">
            {TOOLS.map((key) => (
              <li key={key}>{t.rich(`tools.${key}`, { b: bold })}</li>
            ))}
          </ul>
        </Section>

        <Section id="conduct-moderators" title={t("moderators.title")}>
          <ul className="list-disc space-y-2 pl-5">
            {MODERATORS.map((key) => (
              <li key={key}>{t(`moderators.${key}`)}</li>
            ))}
          </ul>
        </Section>

        <Section id="conduct-contact" title={t("contact.title")}>
          <p>{t.rich("contact.appeal", { email: CONTACT_EMAIL, mail })}</p>
          <p>{t("contact.legal")}</p>
        </Section>
      </main>
    </div>
  );
}
