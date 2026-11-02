/**
 * A moderation history (what was done to an account or about a report), and
 * the other reports against the same account. Server components, no state.
 */
import { useFormatter, useTranslations } from "next-intl";

import { DATE_TIME } from "@/components/profile/format";
import type { HistoryEntry, OtherReport } from "@/lib/moderation/admin";
import { Link } from "@/lib/i18n/navigation";

import { Tag } from "./Section";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Kind-specific facts of an entry (rename: from → to; ban: until / permanent). */
function EntryDetails({ entry }: { entry: HistoryEntry }) {
  const t = useTranslations("admin");
  const format = useFormatter();
  const details = record(entry.details);
  if (entry.kind === "rename") {
    const from = str(details.from);
    const to = str(details.to);
    return from && to ? <span>{t("history.renamed", { from, to })}</span> : null;
  }
  if (entry.kind === "ban") {
    const expiresAt = str(details.expiresAt);
    const date = expiresAt ? new Date(expiresAt) : null;
    if (date && !Number.isNaN(date.getTime())) {
      return <span>{t("history.banUntil", { date: format.dateTime(date, DATE_TIME) })}</span>;
    }
    return details.expiresAt === null ? <span>{t("history.banPermanent")}</span> : null;
  }
  return null;
}

export function HistoryList({
  entries,
  currentReportId,
}: {
  entries: readonly HistoryEntry[];
  /** Entries about another report link to it. */
  currentReportId?: string;
}) {
  const t = useTranslations("admin");
  const format = useFormatter();
  if (entries.length === 0) return <p className="text-ink-muted">{t("report.noHistory")}</p>;
  return (
    <ol className="divide-y divide-rule" data-testid="history">
      {entries.map((entry) => (
        <li key={entry.id} className="space-y-1 py-2" data-kind={entry.kind}>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{t(`history.kind.${entry.kind}`)}</span>
            <EntryDetails entry={entry} />
            <span className="text-sm text-ink-muted">
              {entry.moderatorName
                ? t("history.by", { name: entry.moderatorName })
                : t("history.byUnknown")}
              {" · "}
              <time dateTime={entry.createdAt.toISOString()}>
                {format.dateTime(entry.createdAt, DATE_TIME)}
              </time>
            </span>
          </p>
          {entry.note && <p className="whitespace-pre-wrap break-words">{entry.note}</p>}
          {entry.reportId && entry.reportId !== currentReportId && (
            <Link
              href={{ pathname: "/admin/signalements/[id]", params: { id: entry.reportId } }}
              className="text-sm underline underline-offset-4"
            >
              {t("history.onReport")}
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

export function OtherReports({ reports }: { reports: readonly OtherReport[] }) {
  const t = useTranslations("admin");
  const format = useFormatter();
  if (reports.length === 0) return <p className="text-ink-muted">{t("report.noOtherReports")}</p>;
  return (
    <ul className="divide-y divide-rule" data-testid="other-reports">
      {reports.map((report) => (
        <li key={report.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
          <Link
            href={{ pathname: "/admin/signalements/[id]", params: { id: report.id } }}
            className="underline underline-offset-4"
          >
            {t("report.otherReport", {
              reason: t(`reasons.${report.reason}`),
              name: report.reporterName,
            })}
          </Link>
          <Tag>{t(`status.${report.status}`)}</Tag>
          <time dateTime={report.receivedAt.toISOString()} className="text-sm text-ink-muted">
            {format.dateTime(report.receivedAt, DATE_TIME)}
          </time>
        </li>
      ))}
    </ul>
  );
}
