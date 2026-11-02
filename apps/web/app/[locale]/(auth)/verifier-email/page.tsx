import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { VerifyEmailForm } from "@/components/auth/AuthForms";
import { AuthPage } from "@/components/auth/AuthPage";
import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/verifier-email">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("meta.verify"), robots: { index: false }, referrer: "no-referrer" };
}

/** The link in the verification e-mail opens this page; the button consumes the token (POST). */
export default async function VerifyEmailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/verifier-email">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <AuthPage locale={locale} title={t("verify.title")} lead={t("verify.lead")}>
      {token ? (
        <VerifyEmailForm token={token} />
      ) : (
        <div role="alert" className="space-y-2">
          <h2 className="font-display text-2xl">{t("verify.invalid")}</h2>
          <p>{t("verify.invalidLead")}</p>
        </div>
      )}
      <Link href="/jouer" className={buttonClass("secondary", "w-full")}>
        {t("verify.play")}
      </Link>
    </AuthPage>
  );
}
