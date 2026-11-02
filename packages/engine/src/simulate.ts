import { apply } from "./apply";
import { checkInvariants } from "./invariants";
import { legalActions, pendingActors } from "./legal";
import { setup } from "./setup";
import type { Action, GameState, Move, Seat, Seed } from "./types";

/** Small deterministic random source (mulberry32) for drivers, bots and tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomGameOptions {
  /** Stop with a violation after this many actions. */
  maxActions?: number;
  /** Run `checkInvariants` after every action. */
  checkInvariants?: boolean;
  /** Called after every accepted action. */
  onStep?: (state: GameState, move: Move) => void;
}

export interface RandomGameResult {
  state: GameState;
  moves: Move[];
  violations: string[];
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))] as T;
}

/**
 * Play a whole game with uniformly random legal actions. Used to exercise the
 * engine (property tests, `npm run simulate`) and later by dev bots.
 */
export function playRandomGame(
  playerCount: number,
  seed: Seed,
  rand: () => number,
  options: RandomGameOptions = {},
): RandomGameResult {
  const maxActions = options.maxActions ?? 2000;
  let { state } = setup(playerCount, seed);
  const moves: Move[] = [];
  const violations: string[] = options.checkInvariants ? checkInvariants(state) : [];

  while (state.phase.kind !== "over") {
    if (moves.length >= maxActions) {
      violations.push(`game did not end within ${maxActions} actions`);
      break;
    }
    const seat: Seat = pick(pendingActors(state), rand);
    const action: Action = pick(legalActions(state, seat), rand);
    const move = { seat, action };
    const result = apply(state, move);
    /* v8 ignore next 4 -- defensive: the property tests prove legal actions are always accepted */
    if (!result.ok) {
      violations.push(`legal action rejected: ${JSON.stringify(move)} → ${result.error.code}`);
      break;
    }
    state = result.state;
    moves.push(move);
    options.onStep?.(state, move);
    if (options.checkInvariants) {
      violations.push(...checkInvariants(state).map((v) => `after move ${moves.length}: ${v}`));
    }
  }
  return { state, moves, violations };
}
