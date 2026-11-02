import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { normalizeRoomCode } from "@sh/protocol";

import { NameGate } from "@/components/room/NameGate";
import { RoomScreen } from "@/components/room/RoomScreen";
import { SiteHeader } from "@/components/site/SiteHeader";
import { readGuest } from "@/lib/guest/session";
import { redirect } from "@/lib/i18n/navigation";
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

  const [info, guest] = await Promise.all([roomInfo(code), readGuest()]);
  if (!info) notFound();
  const t = await getTranslations({ locale, namespace: "room" });

  let body: React.ReactNode;
  if (info.visibility === "public") {
    body = (
      <section className="mx-auto max-w-md rounded-lg border-2 border-ink bg-paper-raised p-6">
        <h1 className="font-display text-3xl">{t("publicGate.title")}</h1>
        <p className="mt-3">{t("publicGate.lead")}</p>
      </section>
    );
  } else if (!guest) {
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
