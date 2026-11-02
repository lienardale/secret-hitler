import {
  DECK_COMPOSITION,
  DECK_SIZE,
  FASCIST_POLICIES_TO_WIN,
  LIBERAL_POLICIES_TO_WIN,
  ROLE_TABLE,
  TRACKER_LIMIT,
} from "./constants";
import { eligibleChancellors } from "./eligibility";
import { pendingActors } from "./legal";
import { aliveCount } from "./rotation";
import type { GameState, Policy } from "./types";

/** Policies held in a hand or shown in a peek during the current phase (peeked tiles stay in the deck). */
function policiesInHand(state: GameState): Policy[] {
  const phase = state.phase;
  switch (phase.kind) {
    case "presidentDiscard":
    case "chancellorEnact":
    case "vetoResponse":
      return phase.hand;
    default:
      return [];
  }
}

/**
 * Structural checks that must hold after every action. Returns a list of
 * violations (empty when the state is sound). Used by the property tests and
 * the `simulate` script.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };
  const over = state.phase.kind === "over";

  // Cards: every tile is in exactly one place.
  const all = [
    ...state.deck,
    ...state.discard,
    ...policiesInHand(state),
    ...Array<Policy>(state.liberal).fill("L"),
    ...Array<Policy>(state.fascist).fill("F"),
  ];
  if (all.length !== DECK_SIZE) fail(`card count is ${all.length}, expected ${DECK_SIZE}`);
  const liberals = all.filter((p) => p === "L").length;
  if (liberals !== DECK_COMPOSITION.L) fail(`liberal tile count is ${liberals}`);

  // Roles.
  const table = ROLE_TABLE[state.playerCount];
  const count = (role: string): number => state.roles.filter((r) => r === role).length;
  if (count("hitler") !== 1) fail("there must be exactly one Hitler");
  if (count("fascist") !== table.fascist) fail("wrong number of fascists");
  if (count("liberal") !== table.liberal) fail("wrong number of liberals");
  if (state.roles.length !== state.playerCount) fail("roles length differs from player count");

  // Boards and tracker.
  if (state.tracker < 0 || state.tracker >= TRACKER_LIMIT)
    fail(`tracker out of range: ${state.tracker}`);
  if (state.liberal > LIBERAL_POLICIES_TO_WIN) fail("too many liberal policies");
  if (state.fascist > FASCIST_POLICIES_TO_WIN) fail("too many fascist policies");
  const policyWin =
    state.liberal >= LIBERAL_POLICIES_TO_WIN || state.fascist >= FASCIST_POLICIES_TO_WIN;
  if (policyWin && !over) fail("a policy track is full but the game goes on");

  // Players.
  const hitler = state.roles.indexOf("hitler");
  if (aliveCount(state) < state.playerCount - 2) fail("more than two players were executed");
  if (!state.alive[state.president]) fail("the President is dead");
  if (state.confirmedNotHitler[hitler]) fail("Hitler was confirmed not to be Hitler");
  if (
    !state.alive[hitler] &&
    !(over && state.phase.kind === "over" && state.phase.reason === "hitlerExecuted")
  ) {
    fail("Hitler is dead but the liberals have not won");
  }

  // Flow.
  if (!over) {
    if (pendingActors(state).length === 0) fail("nobody can act");
    if ((state.phase.kind === "nominate" || state.phase.kind === "vote") && state.deck.length < 3) {
      fail(`draw pile has ${state.deck.length} tiles before an election`);
    }
    if (state.phase.kind === "nominate" && eligibleChancellors(state).length === 0) {
      fail("no eligible Chancellor");
    }
  }
  return problems;
}
