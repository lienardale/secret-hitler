/**
 * Small line icons for powers and seat badges, drawn for this project.
 * Decorative unless `title` is given: a visible label always goes with them.
 */
import type { ArtProps } from "./emblems";

function Line({ title, children, ...props }: ArtProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      {...props}
    >
      {children}
    </svg>
  );
}

/** Investigate loyalty: a magnifying glass. */
export function InvestigateIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <circle cx="10" cy="10" r="6" />
      <path d="m14.5 14.5 6 6" />
    </Line>
  );
}

/** Policy peek: an eye. */
export function PeekIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Line>
  );
}

/** Special election: a person with a star. */
export function SpecialElectionIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 21c0-3.9 2.9-6.8 6.5-6.8s6.5 2.9 6.5 6.8" />
      <path d="m18.5 3 .9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2.1-.3Z" />
    </Line>
  );
}

/** Execution: a crosshair. */
export function ExecuteIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </Line>
  );
}

/** Veto: a struck-through circle. */
export function VetoIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </Line>
  );
}

/** Chaos: a lightning bolt. */
export function ChaosIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M13 2 5 13.5h6L10 22l9-12h-6Z" />
    </Line>
  );
}

/** Draw pile: stacked cards. */
export function DeckIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <rect x="7" y="3" width="12" height="16" rx="1.5" />
      <path d="M5 6.5v12A2.5 2.5 0 0 0 7.5 21H15" />
    </Line>
  );
}

/** Discard pile: a card with a cross. */
export function DiscardIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </Line>
  );
}

/** Has voted: a tick. */
export function CheckIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Line>
  );
}

/** Waiting: an hourglass. */
export function HourglassIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M6 2.5h12M6 21.5h12M7 2.5c0 5 10 5 10 9.5S7 16.5 7 21.5M17 2.5c0 5-10 5-10 9.5s10 4.5 10 9.5" />
    </Line>
  );
}

/** Timer: a clock. */
export function ClockIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4.5l3 2M9.5 2.5h5" />
    </Line>
  );
}

/** Term-limited: a padlock. */
export function LockIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Line>
  );
}

/** Confirmed not Hitler: a shield with a tick. */
export function ShieldIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.3 7.5 10 4.3-1.7 7.5-5.4 7.5-10v-6Z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </Line>
  );
}

/** Executed: a tombstone. */
export function TombIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M6 21.5V10a6 6 0 0 1 12 0v11.5M3.5 21.5h17M12 8v6M9.5 10.5h5" />
    </Line>
  );
}

/** Disconnected: a broken link. */
export function OfflineIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M9.5 6.5 11 5a4.2 4.2 0 0 1 6 6l-1.5 1.5M14.5 17.5 13 19a4.2 4.2 0 0 1-6-6l1.5-1.5M3 3l18 18" />
    </Line>
  );
}

/** Played automatically: circular arrows. */
export function AutoIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" />
      <path d="M18.5 3v4.5H14M5.5 21v-4.5H10" />
    </Line>
  );
}

/** Private information: a closed eye. */
export function PrivateIcon(props: ArtProps) {
  return (
    <Line {...props}>
      <path d="M3 10c2.2 2.8 5.3 4.5 9 4.5s6.8-1.7 9-4.5M7 13.4 5.5 16M17 13.4l1.5 2.6M12 14.5V17.5" />
    </Line>
  );
}
