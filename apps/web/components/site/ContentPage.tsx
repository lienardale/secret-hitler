/**
 * Building blocks of the text pages (rules, credits, legal notice, privacy):
 * one h1 with its lead, then framed sections, each an h2 with an id so it can
 * be linked (`/credits#what-we-changed`). Same look as the code of conduct.
 */
import { SiteHeader } from "@/components/site/SiteHeader";
import type { Locale } from "@/lib/i18n/routing";

type SwitchHref = NonNullable<Parameters<typeof SiteHeader>[0]["switchHref"]>;

export function ContentPage({
  locale,
  switchHref,
  title,
  lead,
  aside,
  children,
}: {
  locale: Locale;
  /** This page, so the language switch stays on it. */
  switchHref: SwitchHref;
  title: string;
  lead?: React.ReactNode;
  /** Shown under the lead: a key link, a "last updated" line… */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} switchHref={switchHref} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
        <header className="space-y-3">
          <h1 className="font-display text-5xl tracking-wide break-words">{title}</h1>
          {lead && <p className="text-lg">{lead}</p>}
          {aside}
        </header>
        {children}
      </main>
    </div>
  );
}

/** A framed section; `id` goes on its heading, which names the region. */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="space-y-3 rounded-lg border-2 border-ink bg-paper-raised p-5 shadow-sm"
    >
      <h2 id={id} className="scroll-mt-6 font-display text-3xl break-words">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A sub-heading inside a section (h3). */
export function SubHeading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-6 pt-2 text-xl font-semibold">
      {children}
    </h3>
  );
}

/** Link styles for text links on these pages (an external link opens in place). */
export const TEXT_LINK = "font-semibold text-liberal underline underline-offset-4";
