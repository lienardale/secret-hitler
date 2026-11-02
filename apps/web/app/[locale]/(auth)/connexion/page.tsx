import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { googleEnabled } from "@/auth";
import { GoogleButton, SignInForm } from "@/components/auth/AuthForms";
import { AuthPage, OrDivider } from "@/components/auth/AuthPage";
import { buttonClass } from "@/components/ui/Button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { authErrorKey } from "@/lib/auth/errors";
import { safeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/connexion">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("meta.signIn"), robots: { index: false } };
}

export default async function SignInPage({
  params,
  searchParams,
}: PageProps<"/[locale]/connexion">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const query = await searchParams;
  const rawCallback = typeof query.callbackUrl === "string" ? query.callbackUrl : undefined;
  const callbackUrl = rawCallback ? safeCallbackUrl(rawCallback, locale) : undefined;
  const errorKey = authErrorKey(typeof query.error === "string" ? query.error : null);
  const [t, user] = await Promise.all([
    getTranslations({ locale, namespace: "auth" }),
    getCurrentUser(),
  ]);

  if (user) {
    return (
      <AuthPage locale={locale} title={t("signIn.title")}>
        <p>{t("signIn.signedInAs", { name: user.displayName ?? user.email })}</p>
        <a href={callbackUrl ?? `/${locale}`} className={buttonClass("primary", "w-full")}>
          {t("signIn.continue")}
        </a>
      </AuthPage>
    );
  }

  return (
    <AuthPage locale={locale} title={t("signIn.title")} lead={t("signIn.lead")}>
      {errorKey && (
        <p role="alert" className="text-fascist">
          {t(`errors.${errorKey}` as "errors.authFailed")}
        </p>
      )}
      <SignInForm callbackUrl={callbackUrl} />
      {googleEnabled() && (
        <>
          <OrDivider label={t("signIn.or")} />
          <GoogleButton callbackUrl={callbackUrl} />
        </>
      )}
      <p className="text-center">
        {t("signIn.noAccount")}{" "}
        <Link
          href={callbackUrl ? { pathname: "/inscription", query: { callbackUrl } } : "/inscription"}
          className="text-liberal underline underline-offset-4"
        >
          {t("signIn.signUpLink")}
        </Link>
      </p>
    </AuthPage>
  );
}
