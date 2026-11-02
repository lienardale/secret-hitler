import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { ResendVerificationButton } from "@/components/auth/AuthForms";
import { PublicLobby } from "@/components/lobby/PublicLobby";
import { QuickMatchForm } from "@/components/lobby/QuickMatchForm";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClass } from "@/components/ui/Button";
import { getCurrentUser, isOnboarded } from "@/lib/auth/current-user";
import { getEnv } from "@/lib/env";
import { getPathname, Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/jouer">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "lobby" });
  return { title: t("meta.title") };
}

/** Public games: quick match (accounts) and the live list of public rooms (everyone). */
export default async function PlayPage({ params }: PageProps<"/[locale]/jouer">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, user] = await Promise.all([
    getTranslations({ locale, namespace: "lobby" }),
    getCurrentUser(),
  ]);
  const env = getEnv();
  const here = getPathname({ locale, href: "/jouer" });
  const needsVerification = env.REQUIRE_EMAIL_VERIFICATION && user !== null && !user.emailVerified;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} switchHref="/jouer" />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-10">
        <header>
          <h1 className="font-display text-5xl tracking-wide">{t("page.title")}</h1>
          <p className="mt-3 max-w-2xl text-lg">{t("page.lead")}</p>
        </header>

        <section className="rounded-lg border-2 border-ink bg-paper-raised p-5 shadow-sm">
          <h2 className="font-display text-3xl">{t("quick.title")}</h2>
          <p className="mt-2 text-ink-muted">{t("quick.lead")}</p>
          <div className="mt-5 max-w-sm">
            {!isOnboarded(user) ? (
              <div className="space-y-3">
                <p>{t("quick.signIn")}</p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={{ pathname: "/connexion", query: { callbackUrl: here } }}
                    className={buttonClass("primary")}
                  >
                    {t("quick.signInButton")}
                  </Link>
                  <Link
                    href={{ pathname: "/inscription", query: { callbackUrl: here } }}
                    className={buttonClass("secondary")}
                  >
                    {t("quick.signUpButton")}
                  </Link>
                </div>
              </div>
            ) : needsVerification ? (
              <div className="space-y-2">
                <p>{t("quick.verify")}</p>
                <ResendVerificationButton email={user.email} />
              </div>
            ) : (
              <QuickMatchForm />
            )}
          </div>
        </section>

        <PublicLobby roomsUrl={env.ROOMS_PUBLIC_URL} />
      </main>
    </div>
  );
}
