"use client";

import type { GameEvent, Party, Seat } from "@sh/engine";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { InvestigateIcon } from "./art";
import { CardBack, RoleFace } from "./cards";
import { HOLD, useHoldToReveal } from "./hold";
import type { SeatNames } from "./names";
import { BUTTON } from "./ui";

export interface InvestigationNotice {
  /** Index of the `investigationResult` event in the viewer's log (a stable id). */
  index: number;
  target: Seat;
  party: Party;
}

/**
 * The result of the viewer's latest investigation, while it is fresh: from
 * the private `investigationResult` event (only its President receives it)
 * until the round after the one that follows it starts. The investigation
 * itself starts the next round at once, so the result stays up through that
 * round's nomination, vote and session, when the President tells the table.
 */
export function currentInvestigation(
  log: readonly GameEvent[],
  seat: Seat,
): InvestigationNotice | null {
  let rounds = 0;
  for (let index = log.length - 1; index >= 0; index--) {
    const event = log[index] as GameEvent;
    if (event.type === "roundStarted" && ++rounds > 1) return null;
    if (event.type === "investigationResult") {
      return event.president === seat ? { index, target: event.target, party: event.party } : null;
    }
  }
  return null;
}

/**
 * "You investigated Basile", the party behind press-and-hold, and the reminder
 * that only the President knows. Shown above the action panel; the President
 * may close it (the result stays on the role card, also behind the hold).
 */
export function InvestigationPanel({
  log,
  seat,
  names,
}: {
  log: readonly GameEvent[];
  seat: Seat;
  names: SeatNames;
}) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const notice = currentInvestigation(log, seat);
  if (!notice || notice.index === dismissed) return null;
  return (
    <InvestigationResult
      key={notice.index}
      notice={notice}
      names={names}
      onDismiss={() => {
        setDismissed(notice.index);
        // The focused Close button disappears: keep keyboard users at the action panel.
        document.querySelector<HTMLElement>('[data-testid="action-panel"]')?.focus();
      }}
    />
  );
}

function InvestigationResult({
  notice,
  names,
  onDismiss,
}: {
  notice: InvestigationNotice;
  names: SeatNames;
  onDismiss: () => void;
}) {
  const t = useTranslations("game");
  const { revealed, buttonProps } = useHoldToReveal();
  const headingId = useId();
  const hintId = useId();
  const infoId = useId();
  const name = names.plain(notice.target);
  const tone = notice.party === "liberal" ? "text-liberal" : "text-fascist";

  return (
    <section
      aria-labelledby={headingId}
      data-testid="investigation-result"
      className="sh-deal min-w-0 rounded-xl border-2 border-ink bg-paper-raised p-3 shadow-sm"
    >
      <h2 id={headingId} className="flex items-center gap-2 font-display text-xl leading-tight">
        <InvestigateIcon className="size-5 shrink-0" />
        {t("investigation.title", { name })}
      </h2>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          aria-describedby={hintId}
          aria-controls={infoId}
          className={`${HOLD} w-14 shrink-0 touch-none rounded-md focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink`}
          {...buttonProps}
        >
          <span className="sr-only">{t("investigation.hold")}</span>
          <span key={revealed ? "face" : "back"} className="sh-flip block" aria-hidden>
            {revealed ? (
              <RoleFace role={notice.party} label={t(`party.${notice.party}`)} className="w-full" />
            ) : (
              <CardBack label={t("investigation.hidden")} className="w-full" />
            )}
          </span>
        </button>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-display text-base leading-tight">{t("investigation.hold")}</p>
          <p id={hintId} className="mt-0.5 text-xs text-ink-muted">
            {t("investigation.holdHint")}
          </p>
          <p id={infoId} aria-live="polite" className="mt-1 min-h-5">
            {revealed ? (
              <strong className={`font-display text-base ${tone}`}>
                {t("investigation.result", { name, party: notice.party })}
              </strong>
            ) : null}
          </p>
        </div>
      </div>
      <p className="mt-2 text-sm">{t("investigation.secret")}</p>
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onDismiss} className={BUTTON.outline}>
          {t("investigation.dismiss")}
        </button>
      </div>
    </section>
  );
}
