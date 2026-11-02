import { getTranslations } from "next-intl/server";

import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";

/** Thin header shared by every page: home link and the other language. */
export async function SiteHeader({
  locale,
  switchHref = "/",
}: {
  locale: Locale;
  switchHref?: "/";
}) {
  const t = await getTranslations({ locale, namespace: "common" });
  const other = locale === "fr" ? "en" : "fr";
  return (
    <header className="flex items-center justify-between gap-4 border-b border-rule px-4 py-3">
      <Link href="/" className="font-display text-2xl tracking-wide">
        {t("site.name")}
      </Link>
      <Link
        href={switchHref}
        locale={other}
        className="text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        {t("footer.switchLocale")}
      </Link>
    </header>
  );
}
