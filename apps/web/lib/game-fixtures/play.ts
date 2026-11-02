/**
 * Drive the rules engine locally with seeded random moves: the /dev/table
 * sandbox and the fixtures use this to reach real game states instead of
 * hand-writing them. Deterministic for a given seed.
 *
 * Test/dev code only: it holds the full secret `GameState`, which a real
 * client never has.
 */
import {
  apply,
  legalActions,
  pendingActors,
  seededRandom,
  setup,
  type Action,
  type GameEvent,
  type GameState,
  type Move,
  type PlayerCount,
  type Power,
  type Seat,
  type Seed,
} from "@sh/engine";

/** A game being played locally: the secret state plus every event so far (unfiltered). */
export interface LocalGame {
  state: GameState;
  events: GameEvent[];
}

/** Four 32-bit seed words derived from one number (any number gives a valid seed). */
export function seedWords(seed: number): Seed {
  const rand = seededRandom(seed);
  const word = () => Math.floor(rand() * 0x1_0000_0000) >>> 0;
  return [word(), word(), word(), word()];
}

export function newGame(playerCount: PlayerCount, seed: number): LocalGame {
  const { state, events } = setup(playerCount, seedWords(seed));
  return { state, events };
}

/** Apply one move; returns the game unchanged with the engine's error message if refused. */
export function play(
  game: LocalGame,
  move: Move,
): { ok: true; game: LocalGame; events: GameEvent[] } | { ok: false; error: string } {
  const result = apply(game.state, move);
  if (!result.ok) return { ok: false, error: `${result.error.code}: ${result.error.message}` };
  return {
    ok: true,
    game: { state: result.state, events: [...game.events, ...result.events] },
    events: result.events,
  };
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))] as T;
}

/** A uniformly random legal move (random pending actor, random legal action), or null when over. */
export function randomMove(state: GameState, rand: () => number): Move | null {
  const actors = pendingActors(state);
  if (actors.length === 0) return null;
  const seat: Seat = pick(actors, rand);
  const action: Action = pick(legalActions(state, seat), rand);
  return { seat, action };
}

/** Play one random legal move. Null when the game is over. */
export function randomStep(
  game: LocalGame,
  rand: () => number,
): { game: LocalGame; events: GameEvent[]; move: Move } | null {
  const move = randomMove(game.state, rand);
  if (!move) return null;
  const result = play(game, move);
  /* Legal actions are always accepted (engine property tests). */
  if (!result.ok) throw new Error(`legal move refused: ${result.error}`);
  return { game: result.game, events: result.events, move };
}

/**
 * Play random moves until `stop(state, lastEvents)` holds (checked after each
 * move), the game ends, or `maxSteps` moves were played.
 */
export function playUntil(
  game: LocalGame,
  rand: () => number,
  stop: (state: GameState, lastEvents: readonly GameEvent[]) => boolean,
  maxSteps = 2000,
): { game: LocalGame; reached: boolean; steps: number } {
  let current = game;
  for (let steps = 1; steps <= maxSteps; steps++) {
    const step = randomStep(current, rand);
    if (!step) return { game: current, reached: false, steps: steps - 1 };
    current = step.game;
    if (stop(current.state, step.events)) return { game: current, reached: true, steps };
  }
  return { game: current, reached: false, steps: maxSteps };
}

/** Where "play randomly until…" stops: a phase, or an executive power. */
export type PlayTarget =
  "nominate" | "vote" | "presidentDiscard" | "chancellorEnact" | "vetoResponse" | Power | "over";

export const PLAY_TARGETS: readonly PlayTarget[] = [
  "nominate",
  "vote",
  "presidentDiscard",
  "chancellorEnact",
  "vetoResponse",
  "investigate",
  "peek",
  "specialElection",
  "execute",
  "over",
];

export function isPlayTarget(value: unknown): value is PlayTarget {
  return typeof value === "string" && (PLAY_TARGETS as readonly string[]).includes(value);
}

export function matchesTarget(state: GameState, target: PlayTarget): boolean {
  const phase = state.phase;
  if (phase.kind === "executive") return phase.power === target;
  return phase.kind === target;
}
