/**
 * A player's initials ("AD", "B"), shown before their name on seats and in
 * the player pickers. Decorative for screen readers (the name follows).
 */
export function InitialsBadge({
  initials,
  className = "",
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-initials={initials}
      className={`sh-initials inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-sm border border-current px-1 font-display text-[0.7rem] leading-none tracking-wide tabular-nums ${className}`}
    >
      {initials}
    </span>
  );
}
