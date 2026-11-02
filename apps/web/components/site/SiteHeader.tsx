import { getTranslations } from "next-intl/server";

import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";

/** Header shared by every page: home, public games, the account, the other language. */
export async function SiteHeader({
  locale,
  switchHref = "/",
}: {
  locale: Locale;
  switchHref?: "/" | "/jouer" | "/profil" | "/conduite" | "/admin/signalements" | "/admin/bannis";
}) {
  const [t, user] = await Promise.all([
    getTranslations({ locale, namespace: "common" }),
    getCurrentUser(),
  ]);
  const other = locale === "fr" ? "en" : "fr";
  const linkClass = "text-sm underline-offset-4 hover:underline";
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-4 py-3">
      <Link href="/" className="font-display text-2xl tracking-wide">
        {t("site.name")}
      </Link>
      <nav aria-label={t("nav.label")} className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href="/jouer" className={linkClass}>
          {t("nav.play")}
        </Link>
        <Link href="/conduite" className={linkClass}>
          {t("nav.conduct")}
        </Link>
        {user && user.role !== "USER" && (
          <Link href="/admin/signalements" className={linkClass}>
            {t("nav.admin")}
          </Link>
        )}
        {user ? (
          <>
            {user.onboarded ? (
              <Link href="/profil" className={`${linkClass} font-semibold`}>
                {user.displayName}
              </Link>
            ) : (
              <Link href="/bienvenue" className={`${linkClass} font-semibold`}>
                {t("nav.finishAccount")}
              </Link>
            )}
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className={`${linkClass} text-ink-muted`}>
                {t("nav.signOut")}
              </button>
            </form>
          </>
        ) : (
          <Link href="/connexion" className={linkClass}>
            {t("nav.signIn")}
          </Link>
        )}
        <Link href={switchHref} locale={other} className={`${linkClass} text-ink-muted`}>
          {t("footer.switchLocale")}
        </Link>
      </nav>
    </header>
  );
}
