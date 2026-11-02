"use client";

import type { PlayerView } from "@sh/engine";
import { useTranslations } from "next-intl";

import { ClockIcon, PowerIcon, VetoIcon } from "./art";
import { formatClock, useRemainingSeconds } from "./clock";
import type { SeatNames } from "./names";
import { phaseSummary } from "./status";

/** What is happening now, who the table waits for, and the turn timer. */
export function PhaseBanner({
  view,
  names,
  deadline,
  clockOffset,
}: {
  view: PlayerView;
  names: SeatNames;
  deadline: number | null;
  clockOffset: number;
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
      </div>
      {deadline !== null && !over ? (
        <Countdown deadline={deadline} clockOffset={clockOffset} />
      ) : null}
    </header>
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
