import { legalActions } from "./legal";
import type { Action, GameState, Seat } from "./types";

/**
 * The action played for a seat whose timer ran out (public games), or when a
 * host forces a disconnected player's turn (private games):
 * - vote: Nein (an absent player does not endorse a government);
 * - veto proposed: the President refuses;
 * - anything else: a random legal choice, never a veto proposal.
 *
 * `rand` returns a number in [0, 1). The rooms layer passes its own random
 * source, so the game's seeded RNG is never consumed by timeouts.
 */
export function defaultAction(state: GameState, seat: Seat, rand: () => number): Action | null {
  const legal = legalActions(state, seat);
  if (legal.length === 0) return null;
  if (state.phase.kind === "vote") return { type: "vote", ja: false };
  if (state.phase.kind === "vetoResponse") return { type: "respondVeto", agree: false };
  const candidates = legal.filter((action) => action.type !== "proposeVeto");
  const index = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length));
  return candidates[index] as Action;
}
