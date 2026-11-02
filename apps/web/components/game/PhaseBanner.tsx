"use client";

import type { PlayerView } from "@sh/engine";
import { useTranslations } from "next-intl";

import { CheckIcon, ClockIcon, CrossIcon, PowerIcon, VetoIcon } from "./art";
import { formatClock, useRemainingSeconds } from "./clock";
import { BALLOT_STEP_MS } from "./motion";
import type { SeatNames } from "./names";
import { phaseSummary, voteTally, voteWarnings } from "./status";
import { VoteWarnings } from "./VoteWarnings";

/**
 * What is happening now, who the table waits for, and the turn timer. During
 * a vote: what is at stake, for everyone. After it: the last vote's result
 * strip until the next vote starts (not live: the event log announces it).
 */
export function PhaseBanner({
  view,
  names,
  deadline,
  clockOffset,
  freshVote = false,
}: {
  view: PlayerView;
  names: SeatNames;
  deadline: number | null;
  clockOffset: number;
  /** The last vote just came in: the strip appears after the staged ballots. */
  freshVote?: boolean;
}) {
  const t = useTranslations("game");
  const summary = phaseSummary(view, names, t);
  const phase = view.phase;
  const over = phase.kind === "over";
  const tone = over
    ? phase.winner === "liberal"
      ? "border-liberal"
      : "border-fascist"
    : phase.kind === "executive"
      ? "border-fascist"
      : "border-ink";

  return (
    <header
      className={`sh-banner flex items-start gap-3 rounded-xl border-2 bg-paper-raised p-3 shadow-sm ${tone}`}
    >
      {phase.kind === "executive" ? (
        <PowerIcon power={phase.power} className="mt-1 size-7 shrink-0 text-fascist" />
      ) : phase.kind === "vetoResponse" ? (
        <VetoIcon className="mt-1 size-7 shrink-0 text-fascist" />
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-2xl leading-tight">{summary.title}</h2>
        {summary.detail ? <p className="mt-0.5 text-sm leading-snug">{summary.detail}</p> : null}
        {summary.extra ? (
          <p className="mt-0.5 text-sm leading-snug text-ink-muted">{summary.extra}</p>
        ) : null}
        {phase.kind === "vote" ? (
          <VoteWarnings warnings={voteWarnings(view)} className="mt-2" />
        ) : null}
        {phase.kind !== "vote" && view.lastVote ? (
          <VoteStrip
            votes={view.lastVote.votes}
            passed={view.lastVote.passed}
            delayMs={freshVote ? voters(view.lastVote.votes) * BALLOT_STEP_MS : null}
          />
        ) : null}
      </div>
      {deadline !== null && !over ? (
        <Countdown deadline={deadline} clockOffset={clockOffset} />
      ) : null}
    </header>
  );
}

function voters(votes: readonly (boolean | null)[]): number {
  return votes.filter((vote) => vote !== null).length;
}

/** "Last vote: Ja! 4 – Nein! 3 · Elected" (icon + text). */
function VoteStrip({
  votes,
  passed,
  delayMs,
}: {
  votes: readonly (boolean | null)[];
  passed: boolean;
  /** Fade in after this delay (a fresh result), or null to show at once. */
  delayMs: number | null;
}) {
  const t = useTranslations("game");
  const { ja, nein } = voteTally(votes);
  return (
    <p
      data-testid="vote-strip"
      data-passed={passed ? "true" : "false"}
      style={
        delayMs === null ? undefined : ({ "--sh-delay": `${delayMs}ms` } as React.CSSProperties)
      }
      className={`mt-2 inline-flex flex-wrap items-center gap-x-1.5 rounded-md border-2 border-ink px-2 py-0.5 text-sm ${delayMs === null ? "" : "sh-reveal"}`}
    >
      <span className="text-ink-muted">{t("banner.lastVote")}</span>{" "}
      <span className="font-display tabular-nums">{t("banner.tally", { ja, nein })}</span>{" "}
      <span aria-hidden className="text-ink-muted">
        ·
      </span>{" "}
      <span className="inline-flex items-center gap-1 font-display">
        {passed ? <CheckIcon className="size-4" /> : <CrossIcon className="size-4" />}
        {t(passed ? "banner.elected" : "banner.rejected")}
      </span>
    </p>
  );
}

/**
 * The turn countdown. `role="timer"` is not announced by screen readers on
 * every tick (implicit aria-live off); the label says what it is.
 */
export function Countdown({ deadline, clockOffset }: { deadline: number; clockOffset: number }) {
  const t = useTranslations("game");
  const seconds = useRemainingSeconds(deadline, clockOffset);
  const urgent = seconds !== null && seconds < 10;
  return (
    <div
      role="timer"
      aria-label={t("timer.label")}
      className={`flex shrink-0 items-center gap-1 rounded-lg border-2 px-2 py-1 ${
        urgent ? "sh-urgent border-fascist bg-fascist text-paper" : "border-ink text-ink"
      }`}
    >
      <ClockIcon className="size-4" />
      <span className="font-display text-xl tabular-nums">
        {seconds === null ? "–:––" : formatClock(seconds)}
      </span>
    </div>
  );
}
