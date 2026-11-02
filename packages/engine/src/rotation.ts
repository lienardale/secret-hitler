import type { Ctx } from "./context";
import type { GameState, Seat } from "./types";

export function aliveCount(state: GameState): number {
  return state.alive.filter(Boolean).length;
}

/** The next living seat clockwise after `from` (which may itself be dead). */
export function nextAlive(state: GameState, from: Seat): Seat {
  const n = state.playerCount;
  for (let step = 1; step <= n; step++) {
    const seat = (from + step) % n;
    if (state.alive[seat]) return seat;
  }
  /* c8 ignore next 2 -- unreachable: at least 3 players are always alive */
  throw new Error("nextAlive: no living player");
}

/**
 * Start a regular round: the presidency passes to the next living seat after
 * the rotation seat. After a Special Election the rotation seat is still the
 * President who called it, so the order resumes from their left.
 */
export function startNextRound({ s, events }: Ctx): void {
  s.president = nextAlive(s, s.rotationSeat);
  s.rotationSeat = s.president;
  s.phase = { kind: "nominate" };
  events.push({ type: "roundStarted", president: s.president, special: false });
}
