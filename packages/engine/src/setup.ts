import { DECK_COMPOSITION, ROLE_TABLE, isPlayerCount } from "./constants";
import type { GameEvent } from "./events";
import { createRng, randomInt, shuffle } from "./rng";
import type { GameState, Policy, Role, Seed } from "./types";

/**
 * Deal a new game: shuffle the roles and the policy deck, and pick the first
 * President at random. Seats are already in table order (the rooms layer
 * shuffles players into seats before calling this).
 */
export function setup(playerCount: number, seed: Seed): { state: GameState; events: GameEvent[] } {
  if (!isPlayerCount(playerCount)) {
    throw new RangeError(`Secret Hitler needs 5 to 10 players, got ${playerCount}`);
  }
  const { liberal, fascist } = ROLE_TABLE[playerCount];
  const roleList: Role[] = [
    ...Array<Role>(liberal).fill("liberal"),
    ...Array<Role>(fascist).fill("fascist"),
    "hitler",
  ];
  const deckList: Policy[] = [
    ...Array<Policy>(DECK_COMPOSITION.L).fill("L"),
    ...Array<Policy>(DECK_COMPOSITION.F).fill("F"),
  ];

  let rng = createRng(seed);
  const roles = shuffle(rng, roleList);
  rng = roles.state;
  const deck = shuffle(rng, deckList);
  rng = deck.state;
  const first = randomInt(rng, playerCount);
  rng = first.state;

  const seats = Array.from({ length: playerCount });
  const state: GameState = {
    v: 1,
    playerCount,
    seq: 0,
    roles: roles.items,
    alive: seats.map(() => true),
    investigated: seats.map(() => false),
    confirmedNotHitler: seats.map(() => false),
    deck: deck.items,
    discard: [],
    liberal: 0,
    fascist: 0,
    tracker: 0,
    president: first.value,
    rotationSeat: first.value,
    lastElected: { president: null, chancellor: null },
    phase: { kind: "nominate" },
    investigations: [],
    lastVote: null,
    rng,
  };
  const events: GameEvent[] = [
    { type: "gameStarted", playerCount, president: first.value },
    { type: "roundStarted", president: first.value, special: false },
  ];
  return { state, events };
}
