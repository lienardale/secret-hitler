import { apply } from "./apply";
import { setup } from "./setup";
import type { GameState, Move, Seed } from "./types";

/** Rebuild a game from its seed and its moves. Throws if a move is rejected. */
export function replay(playerCount: number, seed: Seed, moves: readonly Move[]): GameState {
  let { state } = setup(playerCount, seed);
  moves.forEach((move, i) => {
    const result = apply(state, move);
    if (!result.ok) throw new Error(`replay: move ${i} rejected (${result.error.code})`);
    state = result.state;
  });
  return state;
}
