import type { GameEvent } from "./events";
import type { GameState } from "./types";

/**
 * Working context of one `apply()` call: a private copy of the state that
 * phase handlers mutate, and the events they emit. The caller's state is never
 * touched.
 */
export interface Ctx {
  s: GameState;
  events: GameEvent[];
}
