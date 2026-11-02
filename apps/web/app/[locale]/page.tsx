import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

const RULES_PDF = "https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });
  const otherLocale = locale === "fr" ? "en" : "fr";

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10">
      <main className="flex-1">
        <h1 className="font-display text-5xl tracking-wide">{t("site.name")}</h1>
        <p className="mt-4 text-xl">{t("home.tagline")}</p>
        <p className="mt-8 border-l-4 border-fascist pl-4 text-ink-muted">{t("home.comingSoon")}</p>
        <p className="mt-8">
          <a className="text-liberal underline underline-offset-4" href={RULES_PDF}>
            {t("home.rulesPdf")}
          </a>
        </p>
      </main>
      <footer className="mt-12 space-y-2 border-t border-rule pt-4 text-sm text-ink-muted">
        <p>{t("footer.credit")}</p>
        <p>{t("footer.license")}</p>
        <p>
          <Link href="/" locale={otherLocale} className="underline underline-offset-4">
            {t("footer.switchLocale")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
