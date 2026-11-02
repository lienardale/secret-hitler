import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect as nextRedirect } from "next/navigation";

import { OnboardingForm } from "@/components/auth/AuthForms";
import { AuthPage } from "@/components/auth/AuthPage";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { redirect } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/bienvenue">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("meta.welcome"), robots: { index: false } };
}

/** Onboarding: a display name and the 15-or-older confirmation (Google sign-ups land here). */
export default async function WelcomePage({
  params,
  searchParams,
}: PageProps<"/[locale]/bienvenue">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const query = await searchParams;
  const rawCallback = typeof query.callbackUrl === "string" ? query.callbackUrl : undefined;
  const callbackUrl = safeCallbackUrl(rawCallback, locale);

  const user = await getCurrentUser();
  if (!user) {
    redirect({ href: { pathname: "/connexion", query: { callbackUrl } }, locale });
    return null;
  }
  if (user.onboarded) nextRedirect(callbackUrl);

  const t = await getTranslations({ locale, namespace: "auth" });
  return (
    <AuthPage locale={locale} title={t("welcome.title")} lead={t("welcome.lead")}>
      <OnboardingForm callbackUrl={callbackUrl} currentName={user.displayName} />
    </AuthPage>
  );
}
