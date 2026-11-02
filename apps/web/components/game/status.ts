/**
 * What the table is doing and who it is waiting for, as text. Pure helpers
 * over the public part of a `PlayerView` (works the same for spectators).
 */
import {
  DECK_COMPOSITION,
  HITLER_ZONE,
  ROLE_TABLE,
  TRACKER_LIMIT,
  type PlayerCount,
  type PlayerView,
  type Seat,
} from "@sh/engine";
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

/**
 * Every seat the table is waiting for right now, in any phase: the President
 * (nomination, discard, veto answer, executive power), the voters who have not
 * voted yet, or the Chancellor (enacting). Public information: the same for
 * every viewer, spectators included. Empty once the game is over or stopped.
 */
export function waitingSeats(view: PlayerView): Seat[] {
  const phase = view.phase;
  if (view.roles !== null) return [];
  switch (phase.kind) {
    case "vote":
      return waitingVoters(view);
    case "chancellorEnact":
      return [phase.chancellor];
    case "nominate":
    case "presidentDiscard":
    case "vetoResponse":
    case "executive":
      return [view.president];
    case "over":
      return [];
  }
}

export type VoteWarning = "hitlerZone" | "chaos";

/**
 * What is at stake in the coming or current vote: Hitler elected Chancellor
 * wins the game once 3 fascist policies are down; one more failed election
 * enacts the top policy (chaos). Only during a nomination or a vote.
 */
export function voteWarnings(view: PlayerView): VoteWarning[] {
  const kind = view.phase.kind;
  if (kind !== "nominate" && kind !== "vote") return [];
  const warnings: VoteWarning[] = [];
  if (view.fascist >= HITLER_ZONE) warnings.push("hitlerZone");
  if (view.tracker === TRACKER_LIMIT - 1) warnings.push("chaos");
  return warnings;
}

/** Liberals and Fascists at this table (plus one Hitler), from the official role table. */
export function teamComposition(playerCount: PlayerCount): { liberal: number; fascist: number } {
  const row = ROLE_TABLE[playerCount];
  return { liberal: row.liberal, fascist: row.fascist };
}

/**
 * Policies not enacted yet, wherever they are (draw pile, discard, hands):
 * the 6 L / 11 F deck minus the board, chaos-enacted policies included.
 */
export function policiesLeft(view: PlayerView): { liberal: number; fascist: number } {
  return {
    liberal: DECK_COMPOSITION.L - view.liberal,
    fascist: DECK_COMPOSITION.F - view.fascist,
  };
}

/** The last vote's counts, for the banner strip. */
export function voteTally(votes: readonly (boolean | null)[]): { ja: number; nein: number } {
  return {
    ja: votes.filter((vote) => vote === true).length,
    nein: votes.filter((vote) => vote === false).length,
  };
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
