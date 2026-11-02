import { getTranslations } from "next-intl/server";

import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { GAME_COPYRIGHT, GAME_CREDIT, LICENSE_URL } from "@/lib/legal";

const PAGES = [
  ["/regles", "rules"],
  ["/credits", "credits"],
  ["/conduite", "conduct"],
  ["/mentions-legales", "legal"],
  ["/confidentialite", "privacy"],
] as const;

/**
 * Footer of every page (rendered once, by app/[locale]/layout.tsx): the
 * information pages, the original game's credit line (always in English, as
 * the official rules give it) and the licence.
 */
export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "common" });
  const linkClass = "underline-offset-4 hover:underline";
  return (
    <footer className="border-t border-rule px-4 py-6 text-sm text-ink-muted">
      <div className="mx-auto max-w-4xl space-y-3">
        <nav aria-label={t("footer.label")}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {PAGES.map(([href, key]) => (
              <li key={key}>
                <Link href={href} className={`${linkClass} text-ink`}>
                  {t(`footer.${key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>
          <span lang={locale === "en" ? undefined : "en"}>{GAME_CREDIT}</span> {GAME_COPYRIGHT}.
        </p>
        <p>
          {t.rich("footer.license", {
            link: (chunks) => (
              <a href={LICENSE_URL} rel="license" className="underline underline-offset-4">
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>
    </footer>
  );
}
