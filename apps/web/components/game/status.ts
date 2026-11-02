/**
 * What the table is doing and who it is waiting for, as text. Pure helpers
 * over the public part of a `PlayerView` (works the same for spectators).
 */
import type { PlayerView, Seat } from "@sh/engine";
import type { useTranslations } from "next-intl";

import type { SeatNames } from "./names";

export type GameT = ReturnType<typeof useTranslations<"game">>;

export interface PhaseSummary {
  title: string;
  detail: string | null;
  /** A second line: vote count, waiting list, veto refused… */
  extra: string | null;
}

/** Living seats that have not voted yet (during a vote). */
export function waitingVoters(view: PlayerView): Seat[] {
  return view.seats.filter((s) => s.alive && s.hasVoted === false).map((s) => s.seat);
}

/** The Chancellor of the government in session or the nominee, if any. */
export function chancellorOf(view: PlayerView): Seat | null {
  const phase = view.phase;
  switch (phase.kind) {
    case "vote":
      return phase.nominee;
    case "presidentDiscard":
    case "chancellorEnact":
    case "vetoResponse":
      return phase.chancellor;
    default:
      return null;
  }
}

export function phaseSummary(view: PlayerView, names: SeatNames, t: GameT): PhaseSummary {
  const phase = view.phase;
  const president = names.name(view.president);
  switch (phase.kind) {
    case "nominate":
      return {
        title: t("phase.nominate"),
        detail: t("waiting.nominate", { president }),
        extra: null,
      };
    case "vote": {
      const alive = view.seats.filter((s) => s.alive).length;
      const waiting = waitingVoters(view);
      const votes = t("waiting.votes", { cast: alive - waiting.length, total: alive });
      return {
        title: t("phase.vote"),
        detail: t("waiting.vote", { president, nominee: names.name(phase.nominee) }),
        extra:
          waiting.length > 0 && waiting.length <= 4
            ? `${votes} · ${t("waiting.waitingFor", { names: names.list(waiting) })}`
            : votes,
      };
    }
    case "presidentDiscard":
      return {
        title: t("phase.presidentDiscard"),
        detail: t("waiting.presidentDiscard", {
          president,
          chancellor: names.name(phase.chancellor),
        }),
        extra: null,
      };
    case "chancellorEnact":
      return {
        title: t("phase.chancellorEnact"),
        detail: t("waiting.chancellorEnact", { chancellor: names.name(phase.chancellor) }),
        extra: phase.vetoRefused ? t("waiting.vetoRefused", { president }) : null,
      };
    case "vetoResponse":
      return {
        title: t("phase.vetoResponse"),
        detail: t("waiting.vetoResponse", { president, chancellor: names.name(phase.chancellor) }),
        extra: null,
      };
    case "executive":
      return {
        title: t("phase.executive", { power: t(`power.${phase.power}.name`) }),
        detail: t(`waiting.${phase.power}`, { president }),
        extra: null,
      };
    case "over":
      // The game-over panel right below says who won and why.
      return { title: t("phase.over"), detail: null, extra: null };
  }
}
