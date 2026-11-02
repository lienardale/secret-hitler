/**
 * Test helpers: build exact game situations and drive them with assertions.
 */
import { expect } from "vitest";

import { apply, type ApplyResult } from "../../src/apply";
import { DECK_COMPOSITION } from "../../src/constants";
import type { GameEvent } from "../../src/events";
import type {
  Action,
  EngineErrorCode,
  GameState,
  PlayerCount,
  Policy,
  Role,
  Seat,
} from "../../src/types";

export interface StateOptions {
  playerCount?: PlayerCount;
  roles?: Role[];
  /** Draw pile, top first. Defaults to the remaining tiles, liberals on top. */
  deck?: Policy[];
  discard?: Policy[];
  president?: Seat;
  rotationSeat?: Seat;
  liberal?: number;
  fascist?: number;
  tracker?: number;
  alive?: boolean[];
  lastElected?: { president: Seat | null; chancellor: Seat | null };
  investigated?: boolean[];
}

/** Default roles: seat 0 is Hitler, the next seats are fascists, the rest liberals. */
export function defaultRoles(playerCount: PlayerCount): Role[] {
  const fascists = { 5: 1, 6: 1, 7: 2, 8: 2, 9: 3, 10: 3 }[playerCount];
  return Array.from({ length: playerCount }, (_, seat): Role =>
    seat === 0 ? "hitler" : seat <= fascists ? "fascist" : "liberal",
  );
}

/** Tiles not yet on the boards or in the discard pile, liberals first. */
export function remainingTiles(liberal: number, fascist: number, discard: Policy[] = []): Policy[] {
  const l = DECK_COMPOSITION.L - liberal - discard.filter((p) => p === "L").length;
  const f = DECK_COMPOSITION.F - fascist - discard.filter((p) => p === "F").length;
  return [...Array<Policy>(l).fill("L"), ...Array<Policy>(f).fill("F")];
}

export function makeState(options: StateOptions = {}): GameState {
  const playerCount = options.playerCount ?? 7;
  const liberal = options.liberal ?? 0;
  const fascist = options.fascist ?? 0;
  const discard = options.discard ?? [];
  const president = options.president ?? 1;
  const seats = Array.from({ length: playerCount });
  return {
    v: 1,
    playerCount,
    seq: 0,
    roles: options.roles ?? defaultRoles(playerCount),
    alive: options.alive ?? seats.map(() => true),
    investigated: options.investigated ?? seats.map(() => false),
    confirmedNotHitler: seats.map(() => false),
    deck: options.deck ?? remainingTiles(liberal, fascist, discard),
    discard,
    liberal,
    fascist,
    tracker: options.tracker ?? 0,
    president,
    rotationSeat: options.rotationSeat ?? president,
    lastElected: options.lastElected ?? { president: null, chancellor: null },
    phase: { kind: "nominate" },
    investigations: [],
    lastVote: null,
    rng: [1, 2, 3, 4],
  };
}

/** Apply an action that must succeed. */
export function act(
  state: GameState,
  seat: Seat,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  const result: ApplyResult = apply(state, { seat, action });
  if (!result.ok)
    throw new Error(
      `expected ${JSON.stringify(action)} by ${seat} to succeed: ${result.error.code}`,
    );
  return { state: result.state, events: result.events };
}

/** Apply an action that must fail with `code`. */
export function rejects(state: GameState, seat: Seat, action: Action, code: EngineErrorCode): void {
  const result = apply(state, { seat, action });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

/** Every living seat votes; `ja` is one ballot for all or a per-seat function. */
export function voteAll(
  state: GameState,
  ja: boolean | ((seat: Seat) => boolean) = true,
): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (let seat = 0; seat < current.playerCount; seat++) {
    if (current.phase.kind !== "vote") break;
    if (!current.alive[seat] || current.phase.votes[seat] !== null) continue;
    const step = act(current, seat, { type: "vote", ja: typeof ja === "boolean" ? ja : ja(seat) });
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}

/** The President nominates `chancellor` and every living seat votes. */
export function elect(
  state: GameState,
  chancellor: Seat,
  ja: boolean | ((seat: Seat) => boolean) = true,
): { state: GameState; events: GameEvent[] } {
  const nominated = act(state, state.president, { type: "nominate", target: chancellor });
  const voted = voteAll(nominated.state, ja);
  return { state: voted.state, events: [...nominated.events, ...voted.events] };
}

/** In a legislative session, have the government enact `policy` (it must be in the hand). */
export function enact(state: GameState, policy: Policy): { state: GameState; events: GameEvent[] } {
  if (state.phase.kind !== "presidentDiscard")
    throw new Error(`not in presidentDiscard: ${state.phase.kind}`);
  const hand = state.phase.hand;
  // Discard a tile that is not needed so `policy` stays in the chancellor's hand.
  const keepIndex = hand.indexOf(policy);
  if (keepIndex < 0) throw new Error(`hand ${hand.join("")} has no ${policy}`);
  const discardIndex = hand.findIndex((_, i) => i !== keepIndex);
  const discarded = act(state, state.president, { type: "presidentDiscard", index: discardIndex });
  if (discarded.state.phase.kind !== "chancellorEnact") throw new Error("expected chancellorEnact");
  const chancellor = discarded.state.phase.chancellor;
  const index = discarded.state.phase.hand.indexOf(policy);
  const enacted = act(discarded.state, chancellor, { type: "chancellorEnact", index });
  return { state: enacted.state, events: [...discarded.events, ...enacted.events] };
}

/** Elect `chancellor` and enact `policy`. */
export function governAndEnact(
  state: GameState,
  chancellor: Seat,
  policy: Policy,
): { state: GameState; events: GameEvent[] } {
  const elected = elect(state, chancellor);
  const enacted = enact(elected.state, policy);
  return { state: enacted.state, events: [...elected.events, ...enacted.events] };
}

/** Fail an election: nominate `chancellor` and everyone votes Nein. */
export function failElection(
  state: GameState,
  chancellor: Seat,
): { state: GameState; events: GameEvent[] } {
  return elect(state, chancellor, false);
}

export function eventTypes(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Recursively freeze a value so any mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
