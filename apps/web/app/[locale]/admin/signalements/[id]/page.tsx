import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { BanForm, DismissForm, ForceRenameForm, NoteForm } from "@/components/admin/AdminForms";
import { AdminNav } from "@/components/admin/AdminNav";
import { HistoryList, OtherReports } from "@/components/admin/History";
import {
  MembersList,
  partyPid,
  PublicGameLog,
  Transcript,
} from "@/components/admin/ReportEvidence";
import { AdminSection, Tag } from "@/components/admin/Section";
import { DATE_TIME } from "@/components/profile/format";
import { SiteHeader } from "@/components/site/SiteHeader";
import { prisma } from "@/lib/db/prisma";
import { getPathname, Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { requireModerator } from "@/lib/moderation/access";
import { getReport, moderationRefusal, type ReportParty } from "@/lib/moderation/admin";

/** Static title: the target's name is only shown once the role check passed. */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/signalements/[id]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("meta.reportsTitle"), robots: { index: false } };
}

const SECTIONS = {
  summary: "report-summary",
  people: "report-people",
  transcript: "report-transcript",
  members: "report-members",
  gameLog: "report-game-log",
  history: "report-history",
  actions: "report-actions",
} as const;

/** One report: what was reported, the evidence the room captured, and the moderator actions. */
export default async function ReportPage({
  params,
}: PageProps<"/[locale]/admin/signalements/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const moderator = await requireModerator(
    locale,
    getPathname({ locale, href: { pathname: "/admin/signalements/[id]", params: { id } } }),
  );
  const report = await getReport(prisma, id);
  if (!report) notFound();

  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: "admin" }),
    getFormatter({ locale }),
  ]);
  const { evidence } = report;
  const targetPid = partyPid(evidence.members, report.target);
  const reporterPid = partyPid(evidence.members, report.reporter);
  const targetId = report.target.id;
  const refusal =
    targetId && report.target.role
      ? moderationRefusal(moderator, { id: targetId, role: report.target.role })
      : null;
  const dateTime = (date: Date) => (
    <time dateTime={date.toISOString()}>{format.dateTime(date, DATE_TIME)}</time>
  );

  const party = (title: string, who: ReportParty, extra?: React.ReactNode) => (
    <div className="space-y-2 rounded-md border-2 border-rule bg-paper p-3">
      <h3 className="font-display text-2xl">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-ink-muted">{t("report.nameAtReport")}</dt>
        <dd className="font-semibold break-words">{who.nameAtReport}</dd>
        <dt className="text-ink-muted">{t("report.currentName")}</dt>
        <dd className="break-words">
          {who.id === null ? t("report.accountDeleted") : (who.currentName ?? t("report.noName"))}
        </dd>
        {extra}
      </dl>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} switchHref="/admin/signalements" />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <AdminNav current="reports" />
        <p>
          <Link href="/admin/signalements" className="underline underline-offset-4">
            ← {t("report.back")}
          </Link>
        </p>
        <header className="space-y-2">
          <h1 className="font-display text-4xl tracking-wide break-words sm:text-5xl">
            {t("report.title", { name: report.target.nameAtReport })}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-lg">
            <Tag tone={report.status === "open" ? "target" : "neutral"}>
              {t(`status.${report.status}`)}
            </Tag>
            <span className="font-semibold">{t(`reasons.${report.reason}`)}</span>
          </p>
        </header>

        <nav aria-label={t("report.sectionsLabel")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {(
              [
                ["summary", t("report.summary")],
                ["people", t("report.people")],
                ["transcript", t("evidence.transcript")],
                ["members", t("evidence.members")],
                ["gameLog", t("evidence.gameLog")],
                ["history", t("report.history")],
                ["actions", t("actions.title")],
              ] as const
            ).map(([key, label]) => (
              <li key={key}>
                <a href={`#${SECTIONS[key]}`} className="underline underline-offset-4">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {!report.evidenceComplete && (
          <p className="rounded-md border-2 border-fascist bg-paper-raised p-3 font-semibold">
            {t("evidence.incomplete")}
          </p>
        )}

        <AdminSection id={SECTIONS.summary} title={t("report.summary")}>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
            <dt className="font-display text-lg">{t("report.reason")}</dt>
            <dd>{t(`reasons.${report.reason}`)}</dd>
            <dt className="font-display text-lg">{t("report.details")}</dt>
            <dd className="break-words whitespace-pre-wrap">
              {report.details || <span className="text-ink-muted">{t("report.noDetails")}</span>}
            </dd>
            <dt className="font-display text-lg">{t("report.room")}</dt>
            <dd>
              <span className="font-mono">{report.room}</span>
              {evidence.status && (
                <span className="block text-sm text-ink-muted">
                  {t(`evidence.roomStatus.${evidence.status}`)}
                  {evidence.game &&
                    ` ${t("evidence.gameNumber", { number: evidence.game.number })}.`}
                </span>
              )}
            </dd>
            <dt className="font-display text-lg">{t("report.createdAt")}</dt>
            <dd>{dateTime(report.createdAt)}</dd>
            <dt className="font-display text-lg">{t("report.receivedAt")}</dt>
            <dd>{dateTime(report.receivedAt)}</dd>
            <dt className="font-display text-lg">{t("report.status")}</dt>
            <dd>
              {report.resolvedAt
                ? report.resolvedByName
                  ? t("report.resolvedBy", {
                      status: t(`status.${report.status}`),
                      name: report.resolvedByName,
                      date: format.dateTime(report.resolvedAt, DATE_TIME),
                    })
                  : t("report.resolvedByUnknown", {
                      status: t(`status.${report.status}`),
                      date: format.dateTime(report.resolvedAt, DATE_TIME),
                    })
                : t(`status.${report.status}`)}
            </dd>
          </dl>
        </AdminSection>

        <AdminSection id={SECTIONS.people} title={t("report.people")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {party(t("report.reporter"), report.reporter)}
            {party(
              t("report.target"),
              report.target,
              <>
                {report.target.role && report.target.role !== "USER" && (
                  <>
                    <dt className="text-ink-muted">{t("report.role")}</dt>
                    <dd>{t(`roles.${report.target.role}`)}</dd>
                  </>
                )}
                {targetId && (
                  <>
                    <dt className="text-ink-muted">{t("report.ban")}</dt>
                    <dd data-testid="target-ban">
                      {report.activeBan ? (
                        <>
                          <span className="font-semibold">
                            {report.activeBan.expiresAt
                              ? t("report.activeBan", {
                                  date: format.dateTime(report.activeBan.expiresAt, DATE_TIME),
                                })
                              : t("report.activeBanPermanent")}
                          </span>
                          <span className="block text-sm break-words">
                            {t("report.banReason", { reason: report.activeBan.reason })}
                          </span>
                        </>
                      ) : (
                        t("report.notBanned")
                      )}
                    </dd>
                  </>
                )}
              </>,
            )}
          </div>
        </AdminSection>

        <Transcript
          headingId={SECTIONS.transcript}
          chat={evidence.chat}
          targetPid={targetPid}
          reporterPid={reporterPid}
        />
        <MembersList
          headingId={SECTIONS.members}
          members={evidence.members}
          targetPid={targetPid}
          reporterPid={reporterPid}
        />
        <PublicGameLog
          headingId={SECTIONS.gameLog}
          events={evidence.events}
          members={evidence.members}
          game={evidence.game}
        />

        <AdminSection id={SECTIONS.history} title={t("report.history")}>
          <HistoryList entries={report.history} currentReportId={report.id} />
          <h3 className="font-display text-2xl">{t("report.otherReports")}</h3>
          <OtherReports reports={report.otherReports} />
        </AdminSection>

        <AdminSection id={SECTIONS.actions} title={t("actions.title")}>
          {report.status !== "open" && <p>{t("actions.closed")}</p>}
          {targetId === null ? (
            <p>{t("actions.targetDeleted")}</p>
          ) : refusal ? (
            <p>{t("actions.protected")}</p>
          ) : (
            <>
              <BanForm userId={targetId} reportId={report.id} />
              <ForceRenameForm userId={targetId} reportId={report.id} />
            </>
          )}
          <DismissForm reportId={report.id} closed={report.status !== "open"} />
          <NoteForm reportId={report.id} />
        </AdminSection>
      </main>
    </div>
  );
}
