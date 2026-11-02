import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { BanByNameForm, UnbanButton } from "@/components/admin/AdminForms";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminSection } from "@/components/admin/Section";
import { DATE_TIME } from "@/components/profile/format";
import { SiteHeader } from "@/components/site/SiteHeader";
import { prisma } from "@/lib/db/prisma";
import { getPathname, Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { requireModerator } from "@/lib/moderation/access";
import { listActiveBans } from "@/lib/moderation/admin";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/bannis">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("meta.bansTitle"), robots: { index: false } };
}

/** Active bans (with "Lift") and "Ban by display name" for notices received by e-mail. */
export default async function BansPage({ params }: PageProps<"/[locale]/admin/bannis">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireModerator(locale, getPathname({ locale, href: "/admin/bannis" }));

  const [t, format, bans] = await Promise.all([
    getTranslations({ locale, namespace: "admin" }),
    getFormatter({ locale }),
    listActiveBans(prisma),
  ]);
  const dateTime = (date: Date) => (
    <time dateTime={date.toISOString()}>{format.dateTime(date, DATE_TIME)}</time>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} switchHref="/admin/bannis" />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <AdminNav current="bans" />
        <header>
          <h1 className="font-display text-5xl tracking-wide">{t("bans.title")}</h1>
          <p className="mt-2 text-lg text-ink-muted">{t("bans.lead")}</p>
        </header>

        <AdminSection id="bans-list" title={t("bans.listLabel")}>
          {bans.length === 0 ? (
            <p>{t("bans.empty")}</p>
          ) : (
            <ul className="divide-y divide-rule" aria-labelledby="bans-list" data-testid="bans">
              {bans.map((ban) => {
                const name = ban.userName ?? t("bans.noName");
                return (
                  <li
                    key={ban.id}
                    data-testid="ban-row"
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-xl font-semibold break-words">{name}</p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                        <dt className="text-ink-muted">{t("bans.reason")}</dt>
                        <dd className="break-words whitespace-pre-wrap">{ban.reason}</dd>
                        <dt className="text-ink-muted">{t("bans.by")}</dt>
                        <dd>{ban.createdByName ?? t("bans.byUnknown")}</dd>
                        <dt className="text-ink-muted">{t("bans.since")}</dt>
                        <dd>{dateTime(ban.createdAt)}</dd>
                        <dt className="text-ink-muted">{t("bans.until")}</dt>
                        <dd className="font-semibold">
                          {ban.expiresAt ? dateTime(ban.expiresAt) : t("bans.permanent")}
                        </dd>
                      </dl>
                      {ban.reportId && (
                        <Link
                          href={{
                            pathname: "/admin/signalements/[id]",
                            params: { id: ban.reportId },
                          }}
                          className="text-sm underline underline-offset-4"
                        >
                          {t("bans.fromReport")}
                        </Link>
                      )}
                    </div>
                    <UnbanButton banId={ban.id} name={name} />
                  </li>
                );
              })}
            </ul>
          )}
        </AdminSection>

        <BanByNameForm />
      </main>
    </div>
  );
}
