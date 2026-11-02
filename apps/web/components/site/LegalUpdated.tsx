import { LEGAL_UPDATED, formatLegalDate } from "@/lib/legal";

/**
 * "Last updated: …" under the title of the legal notice and the privacy policy:
 * `{t.rich("updated", { date: () => <LegalDate locale={locale} /> })}` inside.
 * Plain (not async) components, so the pages render in jsdom tests too.
 */
export function LegalUpdated({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}

export function LegalDate({ locale }: { locale: string }) {
  return <time dateTime={LEGAL_UPDATED}>{formatLegalDate(LEGAL_UPDATED, locale)}</time>;
}
