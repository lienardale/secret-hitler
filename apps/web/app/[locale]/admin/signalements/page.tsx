import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { Tag } from "@/components/admin/Section";
import { DATE_TIME } from "@/components/profile/format";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClass } from "@/components/ui/Button";
import { prisma } from "@/lib/db/prisma";
import { getPathname, Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { requireModerator } from "@/lib/moderation/access";
import { listReports, type ReportFilter } from "@/lib/moderation/admin";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/signalements">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("meta.reportsTitle"), robots: { index: false } };
}

function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** The report queue: open reports first (oldest first), or every report. */
export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/signalements">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const query = await searchParams;
  const status: ReportFilter = query.status === "all" ? "all" : "open";
  const page = parsePage(query.page);
  await requireModerator(
    locale,
    getPathname({
      locale,
      href: {
        pathname: "/admin/signalements",
        query: { ...(status === "all" ? { status } : {}), ...(page > 1 ? { page } : {}) },
      },
    }),
  );

  const [t, format, list] = await Promise.all([
    getTranslations({ locale, namespace: "admin" }),
    getFormatter({ locale }),
    listReports(prisma, { status, page }),
  ]);
  const filterClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
      active ? "bg-ink font-semibold text-paper" : "border-2 border-rule"
    }`;
  const pageHref = (target: number) => ({
    pathname: "/admin/signalements" as const,
    query: { ...(status === "all" ? { status } : {}), ...(target > 1 ? { page: target } : {}) },
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} switchHref="/admin/signalements" />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <AdminNav current="reports" />
        <header>
          <h1 className="font-display text-5xl tracking-wide">{t("queue.title")}</h1>
          <p className="mt-2 text-lg text-ink-muted">{t("queue.lead")}</p>
        </header>

        <nav aria-label={t("queue.filterLabel")} className="flex flex-wrap gap-2">
          <Link
            href="/admin/signalements"
            aria-current={status === "open" ? "page" : undefined}
            className={filterClass(status === "open")}
          >
            {t("queue.filterOpen", { count: list.openTotal })}
          </Link>
          <Link
            href={{ pathname: "/admin/signalements", query: { status: "all" } }}
            aria-current={status === "all" ? "page" : undefined}
            className={filterClass(status === "all")}
          >
            {t("queue.filterAll")}
          </Link>
        </nav>

        {list.reports.length === 0 ? (
          <p className="text-lg">{t(status === "open" ? "queue.empty" : "queue.emptyAll")}</p>
        ) : (
          <ol aria-label={t("queue.listLabel")} className="space-y-3" data-testid="report-queue">
            {list.reports.map((report) => {
              const othersOpen = report.openForTarget - (report.status === "open" ? 1 : 0);
              return (
                <li
                  key={report.id}
                  data-testid="report-row"
                  data-report-id={report.id}
                  className="space-y-2 rounded-lg border-2 border-rule bg-paper-raised p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-display text-2xl break-words">
                      <Link
                        href={{ pathname: "/admin/signalements/[id]", params: { id: report.id } }}
                        className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        {t("queue.open", { name: report.targetName })}
                      </Link>
                    </h2>
                    <Tag tone={report.status === "open" ? "target" : "neutral"}>
                      {t(`status.${report.status}`)}
                    </Tag>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-ink-muted">{t("queue.reason")}</dt>
                    <dd className="font-semibold">{t(`reasons.${report.reason}`)}</dd>
                    <dt className="text-ink-muted">{t("queue.reportedBy")}</dt>
                    <dd className="break-words">{report.reporterName}</dd>
                    <dt className="text-ink-muted">{t("queue.room")}</dt>
                    <dd className="font-mono">{report.room}</dd>
                    <dt className="text-ink-muted">{t("queue.received")}</dt>
                    <dd>
                      <time dateTime={report.receivedAt.toISOString()}>
                        {format.dateTime(report.receivedAt, DATE_TIME)}
                      </time>
                    </dd>
                  </dl>
                  {report.details && (
                    <p className="line-clamp-2 text-sm break-words whitespace-pre-wrap">
                      {report.details}
                    </p>
                  )}
                  {othersOpen > 0 && (
                    <p className="text-sm font-semibold">
                      {t("queue.openForTarget", { count: report.openForTarget })}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {list.pageCount > 1 && (
          <nav aria-label={t("queue.pagination")} className="flex flex-wrap items-center gap-3">
            {list.page > 1 && (
              <Link href={pageHref(list.page - 1)} className={buttonClass("secondary")}>
                {t("queue.previous")}
              </Link>
            )}
            <p>{t("queue.pageOf", { page: list.page, count: list.pageCount })}</p>
            {list.page < list.pageCount && (
              <Link href={pageHref(list.page + 1)} className={buttonClass("secondary")}>
                {t("queue.next")}
              </Link>
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
