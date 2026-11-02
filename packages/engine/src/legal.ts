import { VETO_UNLOCK } from "./constants";
import { eligibleChancellors } from "./eligibility";
import { isSeat } from "./phases/guards";
import type { Action, GameState, Power, Seat } from "./types";

/** Every action `seat` may take right now (empty when it is not their turn). */
export function legalActions(state: GameState, seat: Seat): Action[] {
  const phase = state.phase;
  if (phase.kind === "over" || !isSeat(state, seat) || !state.alive[seat]) return [];

  switch (phase.kind) {
    case "nominate":
      if (seat !== state.president) return [];
      return eligibleChancellors(state).map((target) => ({ type: "nominate", target }));
    case "vote":
      if (phase.votes[seat] !== null) return [];
      return [
        { type: "vote", ja: true },
        { type: "vote", ja: false },
      ];
    case "presidentDiscard":
      if (seat !== state.president) return [];
      return phase.hand.map((_, index) => ({ type: "presidentDiscard", index }));
    case "chancellorEnact": {
      if (seat !== phase.chancellor) return [];
      const actions: Action[] = phase.hand.map((_, index) => ({ type: "chancellorEnact", index }));
      if (state.fascist >= VETO_UNLOCK && !phase.vetoRefused) actions.push({ type: "proposeVeto" });
      return actions;
    }
    case "vetoResponse":
      if (seat !== state.president) return [];
      return [
        { type: "respondVeto", agree: true },
        { type: "respondVeto", agree: false },
      ];
    case "executive":
      if (seat !== state.president) return [];
      return powerActions(state, phase.power);
  }
}

function powerActions(state: GameState, power: Power): Action[] {
  if (power === "peek") return [{ type: "acknowledgePeek" }];
  return state.alive.flatMap((alive, target): Action[] => {
    if (!alive || target === state.president) return [];
    if (power === "investigate" && state.investigated[target]) return [];
    return [{ type: power, target }];
  });
}

/** Seats that must act before the game can move on. Empty only when the game is over. */
export function pendingActors(state: GameState): Seat[] {
  return state.alive.flatMap((_, seat) => (legalActions(state, seat).length > 0 ? [seat] : []));
}
