import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { CreateRoomForm, JoinRoomForm } from "@/components/home/HomeForms";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClass } from "@/components/ui/Button";
import { getCurrentUser, isOnboarded } from "@/lib/auth/current-user";
import { readGuest } from "@/lib/guest/session";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

const RULES_PDF = "https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, tr, tl, guest, user] = await Promise.all([
    getTranslations({ locale, namespace: "common" }),
    getTranslations({ locale, namespace: "room" }),
    getTranslations({ locale, namespace: "lobby" }),
    readGuest(),
    getCurrentUser(),
  ]);
  const accountName = isOnboarded(user) ? user.displayName : null;
  const playingAs = accountName ?? guest?.name ?? null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <h1 className="font-display text-5xl tracking-wide sm:text-6xl">{t("site.name")}</h1>
        <p className="mt-3 text-xl">{t("home.tagline")}</p>
        {playingAs && (
          <p className="mt-2 text-ink-muted">{tr("home.playingAs", { name: playingAs })}</p>
        )}

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <CreateRoomForm guestName={guest?.name ?? null} accountName={accountName} />
          <JoinRoomForm />
        </div>

        <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-lg border-2 border-fascist bg-paper-raised p-5">
          <div className="max-w-xl">
            <h2 className="font-display text-3xl">{tl("home.title")}</h2>
            <p className="mt-2 text-ink-muted">{tl("home.lead")}</p>
          </div>
          <Link href="/jouer" className={buttonClass("primary")}>
            {tl("home.cta")}
          </Link>
        </section>
        <p className="mt-6">
          <a className="text-liberal underline underline-offset-4" href={RULES_PDF}>
            {t("home.rulesPdf")}
          </a>
        </p>
      </main>
      <footer className="space-y-2 border-t border-rule px-4 py-4 text-sm text-ink-muted">
        <p>{t("footer.credit")}</p>
        <p>{t("footer.license")}</p>
      </footer>
    </div>
  );
}
