import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { normalizeRoomCode } from "@sh/protocol";

import { ResendVerificationButton } from "@/components/auth/AuthForms";
import { NameGate } from "@/components/room/NameGate";
import { RoomScreen } from "@/components/room/RoomScreen";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClass } from "@/components/ui/Button";
import { getCurrentUser, isOnboarded } from "@/lib/auth/current-user";
import { getEnv } from "@/lib/env";
import { readGuest } from "@/lib/guest/session";
import { getPathname, Link, redirect } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { roomInfo } from "@/lib/rooms/api";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/salle/[code]">): Promise<Metadata> {
  const { locale, code } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "room" });
  return { title: t("meta.title", { code: code.toUpperCase() }), robots: { index: false } };
}

export default async function RoomPage({ params }: PageProps<"/[locale]/salle/[code]">) {
  const { locale, code: raw } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const code = normalizeRoomCode(raw);
  if (!code) notFound();
  if (code !== raw) redirect({ href: { pathname: "/salle/[code]", params: { code } }, locale });

  const [info, guest, user] = await Promise.all([roomInfo(code), readGuest(), getCurrentUser()]);
  if (!info) notFound();
  const t = await getTranslations({ locale, namespace: "room" });
  const here = getPathname({ locale, href: { pathname: "/salle/[code]", params: { code } } });

  // Signed in but no display name yet: finish the account first (it is the name players see).
  if (user && !isOnboarded(user)) {
    redirect({ href: { pathname: "/bienvenue", query: { callbackUrl: here } }, locale });
  }

  let body: React.ReactNode;
  if (info.visibility === "public" && !isOnboarded(user)) {
    body = (
      <section className="mx-auto max-w-md rounded-lg border-2 border-ink bg-paper-raised p-6">
        <h1 className="font-display text-3xl">{t("publicGate.title")}</h1>
        <p className="mt-3">{t("publicGate.lead")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={{ pathname: "/connexion", query: { callbackUrl: here } }}
            className={buttonClass("primary")}
          >
            {t("publicGate.signIn")}
          </Link>
          <Link
            href={{ pathname: "/inscription", query: { callbackUrl: here } }}
            className={buttonClass("secondary")}
          >
            {t("publicGate.signUp")}
          </Link>
        </div>
      </section>
    );
  } else if (
    info.visibility === "public" &&
    user &&
    !user.emailVerified &&
    getEnv().REQUIRE_EMAIL_VERIFICATION
  ) {
    body = (
      <section className="mx-auto max-w-md rounded-lg border-2 border-ink bg-paper-raised p-6">
        <h1 className="font-display text-3xl">{t("publicGate.verifyTitle")}</h1>
        <p className="mt-3">{t("publicGate.verifyLead")}</p>
        <div className="mt-4">
          <ResendVerificationButton email={user.email} />
        </div>
      </section>
    );
  } else if (!isOnboarded(user) && !guest) {
    body = <NameGate />;
  } else {
    body = <RoomScreen code={code} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{body}</main>
    </div>
  );
}
