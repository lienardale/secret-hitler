"use client";

/**
 * What just changed on the table, for the reveal animations: found by
 * comparing with the previous render (counts, seats), never with timers in
 * state, so nothing waits and no control is ever delayed. The CSS that uses
 * these flags only moves under `prefers-reduced-motion: no-preference`.
 *
 * Each hook keeps its answer until the watched value changes again, so a
 * re-render does not replay an animation and a page load never plays one.
 */
import type { PlayerView, Seat } from "@sh/engine";
import { useState } from "react";

/** Delay between two ballots in the staged vote reveal. */
export const BALLOT_STEP_MS = 180;

/** `compute(previousKey)` each time `key` changes; the result is kept until the next change. */
function useOnChange<R>(key: string, initial: R, compute: (previous: string) => R): R {
  const [memo, setMemo] = useState({ key, result: initial });
  if (memo.key !== key) {
    const result = compute(memo.key);
    setMemo({ key, result });
    return result;
  }
  return memo.result;
}

/** A vote result just came in (the vote ended since the previous render); false again at the next vote. */
export function useFreshVoteResult(view: PlayerView): boolean {
  const inVote = view.phase.kind === "vote";
  return useOnChange(inVote ? "vote" : "other", false, (previous) => {
    return previous === "vote" && !inVote && view.lastVote !== null;
  });
}

export interface BoardChanges {
  liberal: boolean;
  fascist: boolean;
  /** The election tracker moved up. */
  tracker: boolean;
}

const NO_BOARD_CHANGE: BoardChanges = { liberal: false, fascist: false, tracker: false };

/** Which board counters went up since the previous render. */
export function useBoardChanges(view: PlayerView): BoardChanges {
  const now = [view.liberal, view.fascist, view.tracker];
  return useOnChange(now.join(":"), NO_BOARD_CHANGE, (previous) => {
    const [liberal = 0, fascist = 0, tracker = 0] = previous.split(":").map(Number);
    return {
      liberal: view.liberal > liberal,
      fascist: view.fascist > fascist,
      tracker: view.tracker > tracker,
    };
  });
}

/** Seats executed since the previous render. */
export function useFreshDeaths(view: PlayerView): readonly Seat[] {
  const now = view.seats.map((seat) => (seat.alive ? "1" : "0")).join("");
  return useOnChange(now, [] as Seat[], (previous) =>
    previous.length !== now.length
      ? []
      : view.seats.flatMap((seat) =>
          previous[seat.seat] === "1" && !seat.alive ? [seat.seat] : [],
        ),
  );
}

/**
 * Reveal order of the last vote's ballots: living voters from the President,
 * clockwise (index = seat, value = rank, null for dead seats).
 */
export function ballotOrder(
  votes: readonly (boolean | null)[],
  president: Seat,
): (number | null)[] {
  const n = votes.length;
  const ranks: (number | null)[] = votes.map(() => null);
  let rank = 0;
  for (let k = 0; k < n; k++) {
    const seat = (president + k) % n;
    if (votes[seat] !== null && votes[seat] !== undefined) ranks[seat] = rank++;
  }
  return ranks;
}
