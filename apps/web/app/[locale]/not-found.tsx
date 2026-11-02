import { getLocale, getTranslations } from "next-intl/server";

import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";
import { isLocale, routing } from "@/lib/i18n/routing";

/** The site's 404, inside the locale layout (unknown paths reach it via `[...rest]`). */
export default async function NotFound() {
  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "common" });
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <h1 className="font-display text-4xl">{t("notFound.title")}</h1>
        <p className="mt-4">{t("notFound.lead")}</p>
        <p className="mt-8">
          <Link href="/" className={buttonClass("primary")}>
            {t("notFound.home")}
          </Link>
        </p>
      </main>
    </div>
  );
}
