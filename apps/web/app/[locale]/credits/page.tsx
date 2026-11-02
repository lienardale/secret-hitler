import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ContentPage, Section, TEXT_LINK } from "@/components/site/ContentPage";
import { routing } from "@/lib/i18n/routing";
import {
  GAME_COPYRIGHT,
  GAME_CREDIT,
  LICENSE_URL,
  OFFICIAL_SITE_URL,
  PRINT_AND_PLAY_URL,
  RULES_PDF_URL,
  SOURCE_CODE_URL,
} from "@/lib/legal";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/credits">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "credits" });
  return { title: t("meta.title"), description: t("meta.description") };
}

/**
 * "What we changed", in the order of CREDITS.md. tests/unit/credits-sync.test.ts
 * checks that CREDITS.md and the messages have as many items, and
 * tests/ui/credits.test.tsx that this page shows every item of the messages.
 */
const CHANGES = [
  "online",
  "art",
  "chat",
  "timers",
  "defaults",
  "away",
  "removal",
  "abandoned",
  "cooldown",
  "start",
  "spectators",
  "languages",
] as const;

const FONTS = {
  germania: "https://fonts.google.com/specimen/Germania+One",
  jost: "https://fonts.google.com/specimen/Jost",
  ofl: "https://openfontlicense.org/",
} as const;

/**
 * Credits: the designers' credit line (verbatim, in English), the licence,
 * the not-affiliated and no-money statements, the artwork and fonts, the
 * open-source software, and the list of changes the licence asks for
 * (`#what-we-changed`, linked from the rules page).
 */
export default async function CreditsPage({ params }: PageProps<"/[locale]/credits">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "credits" });
  const external = (href: string) => {
    const ExternalLink = (chunks: React.ReactNode) => (
      <a href={href} className={TEXT_LINK}>
        {chunks}
      </a>
    );
    return ExternalLink;
  };

  return (
    <ContentPage
      locale={locale}
      switchHref="/credits"
      title={t("page.title")}
      lead={t("page.lead")}
    >
      <Section id="original-game" title={t("game.title")}>
        <p>{t("game.intro")}</p>
        <blockquote className="border-l-4 border-fascist pl-4">
          <p className="text-lg font-semibold" lang={locale === "en" ? undefined : "en"}>
            {GAME_CREDIT}
          </p>
          <p>{GAME_COPYRIGHT}</p>
        </blockquote>
        <p>{t.rich("game.site", { link: external(OFFICIAL_SITE_URL) })}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <a href={RULES_PDF_URL} className={TEXT_LINK}>
              {t("game.rules")}
            </a>
          </li>
          <li>
            <a href={PRINT_AND_PLAY_URL} className={TEXT_LINK}>
              {t("game.printAndPlay")}
            </a>
          </li>
        </ul>
      </Section>

      <Section id="licence" title={t("license.title")}>
        <p>
          {t.rich("license.text", {
            link: (chunks) => (
              <a href={LICENSE_URL} rel="license" className={TEXT_LINK}>
                {chunks}
              </a>
            ),
          })}
        </p>
        <p>{t("license.disclaimer")}</p>
      </Section>

      <Section id="no-money" title={t("free.title")}>
        <p>{t("free.text")}</p>
      </Section>

      <Section id="artwork" title={t("art.title")}>
        <p>{t("art.art")}</p>
        <p>
          {t.rich("art.fonts", {
            germania: external(FONTS.germania),
            jost: external(FONTS.jost),
            ofl: external(FONTS.ofl),
          })}
        </p>
      </Section>

      <Section id="software" title={t("software.title")}>
        <p>{t("software.text")}</p>
        <p>
          {SOURCE_CODE_URL
            ? t.rich("software.source", {
                url: SOURCE_CODE_URL,
                link: (chunks) => (
                  <a href={SOURCE_CODE_URL ?? undefined} className={`${TEXT_LINK} break-all`}>
                    {chunks}
                  </a>
                ),
              })
            : t("software.noSource")}
        </p>
      </Section>

      <Section id="what-we-changed" title={t("changed.title")}>
        <p>{t("changed.lead")}</p>
        <ul className="list-disc space-y-3 pl-5">
          {CHANGES.map((key) => (
            <li key={key}>
              <strong>{t(`changed.items.${key}.title`)}</strong> {t(`changed.items.${key}.text`)}
            </li>
          ))}
        </ul>
        <p className="text-ink-muted">{t("changed.kept")}</p>
      </Section>
    </ContentPage>
  );
}
