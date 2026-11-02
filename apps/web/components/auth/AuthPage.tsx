import { SiteHeader } from "@/components/site/SiteHeader";
import type { Locale } from "@/lib/i18n/routing";

/** The frame of the account pages: header, one centred card. */
export function AuthPage({
  locale,
  title,
  lead,
  children,
}: {
  locale: Locale;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <section className="rounded-lg border-2 border-ink bg-paper-raised p-6 shadow-sm">
          <h1 className="font-display text-4xl">{title}</h1>
          {lead && <p className="mt-2 text-ink-muted">{lead}</p>}
          <div className="mt-6 space-y-5">{children}</div>
        </section>
      </main>
    </div>
  );
}

/** "or" between the password form and the Google button. */
export function OrDivider({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-3 text-sm text-ink-muted" aria-hidden="true">
      <span className="h-px flex-1 bg-rule" />
      {label}
      <span className="h-px flex-1 bg-rule" />
    </p>
  );
}
