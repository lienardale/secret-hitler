/** A titled card of the admin pages (same look as the profile page's sections). */
export function AdminSection({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="space-y-4 rounded-lg border-2 border-ink bg-paper-raised p-4 shadow-sm sm:p-5"
    >
      <header className="space-y-1">
        <h2 id={id} className="scroll-mt-4 font-display text-3xl">
          {title}
        </h2>
        {lead && <p className="text-ink-muted">{lead}</p>}
      </header>
      {children}
    </section>
  );
}

/** A small text tag next to a name (never colour alone: the word says it). */
export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "target" | "reporter";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-rule text-ink-muted",
    target: "border-fascist text-fascist",
    reporter: "border-liberal text-liberal",
  } as const;
  return (
    <span
      className={`inline-block rounded-sm border px-1.5 align-[0.1em] text-xs font-semibold tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
