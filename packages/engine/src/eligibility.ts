import { RELAXED_TERM_LIMIT_ALIVE } from "./constants";
import { aliveCount } from "./rotation";
import type { GameState, Seat } from "./types";

/**
 * Term limits: the last elected Chancellor, and the last elected President,
 * cannot be nominated as Chancellor. Once only five (or fewer) players are
 * alive, only the last Chancellor is term-limited. Failed elections do not
 * change who was last elected; chaos clears it.
 */
export function isTermLimited(state: GameState, seat: Seat): boolean {
  if (seat === state.lastElected.chancellor) return true;
  return aliveCount(state) > RELAXED_TERM_LIMIT_ALIVE && seat === state.lastElected.president;
}

export function isEligibleChancellor(state: GameState, seat: Seat): boolean {
  return state.alive[seat] === true && seat !== state.president && !isTermLimited(state, seat);
}

export function eligibleChancellors(state: GameState): Seat[] {
  return state.alive.flatMap((_, seat) => (isEligibleChancellor(state, seat) ? [seat] : []));
}
