import { describe, expect, it } from "vitest";

import { legalActions } from "../../src/legal";
import {
  act,
  elect,
  enact,
  eventTypes,
  failElection,
  makeState,
  remainingTiles,
} from "../helpers/builders";

describe("election tracker", () => {
  it("advances on a failed election and passes the presidency on", () => {
    const state = makeState({ playerCount: 7, president: 1 });
    const { state: next, events } = failElection(state, 3);
    expect(next.tracker).toBe(1);
    expect(next.president).toBe(2);
    expect(next.phase).toEqual({ kind: "nominate" });
    expect(eventTypes(events).slice(-3)).toEqual(["voteResult", "trackerAdvanced", "roundStarted"]);
  });

  it("is not reset by a successful election, only by an enacted policy", () => {
    let state = makeState({ playerCount: 7, president: 1, tracker: 2 });
    state = elect(state, 3).state;
    expect(state.tracker).toBe(2);
    state = enact(state, "L").state;
    expect(state.tracker).toBe(0);
  });
});

describe("chaos (third failed election)", () => {
  it("enacts the top policy, ignores its power, forgets term limits and resets the tracker", () => {
    // 7 players: a 2nd fascist policy would grant Investigate Loyalty.
    const deck = ["F" as const, ...remainingTiles(0, 2)];
    const state = makeState({
      playerCount: 7,
      fascist: 1,
      tracker: 2,
      president: 1,
      deck,
      lastElected: { president: 5, chancellor: 6 },
    });
    const { state: next, events } = failElection(state, 3);
    expect(next.fascist).toBe(2);
    expect(next.tracker).toBe(0);
    expect(next.lastElected).toEqual({ president: null, chancellor: null });
    expect(next.phase).toEqual({ kind: "nominate" });
    expect(next.president).toBe(2);
    expect(events).toContainEqual({ type: "policyEnacted", policy: "F", byChaos: true });
    expect(eventTypes(events)).not.toContain("powerGranted");
    // Term limits are forgotten: the old government can be nominated again.
    act(next, 2, { type: "nominate", target: 6 });
  });

  it("does not check for Hitler: nobody was elected", () => {
    const state = makeState({
      playerCount: 7,
      fascist: 3,
      tracker: 2,
      president: 1,
      deck: ["F", ...remainingTiles(0, 4)],
    });
    const { state: next } = failElection(state, 0); // seat 0 is Hitler
    expect(next.phase.kind).toBe("nominate");
    expect(next.fascist).toBe(4);
  });

  it("can win the game for the fascists", () => {
    const state = makeState({ fascist: 5, tracker: 2, deck: ["F", "L", "L"] });
    const { state: next, events } = failElection(state, 3);
    expect(next.phase).toEqual({ kind: "over", winner: "fascist", reason: "fascistPolicies" });
    expect(events.at(-1)).toMatchObject({ type: "gameOver", winner: "fascist" });
  });

  it("can win the game for the liberals", () => {
    const state = makeState({ liberal: 4, tracker: 2, deck: ["L", "F", "F"] });
    expect(failElection(state, 3).state.phase).toEqual({
      kind: "over",
      winner: "liberal",
      reason: "liberalPolicies",
    });
  });

  it("a 5th fascist policy from chaos unlocks the veto", () => {
    const deck = ["F" as const, "L" as const, "F" as const, "F" as const, ...remainingTiles(4, 7)];
    let state = makeState({ playerCount: 7, fascist: 4, tracker: 2, president: 1, deck });
    state = failElection(state, 3).state;
    expect(state.fascist).toBe(5);
    state = elect(state, 4).state;
    state = act(state, state.president, { type: "presidentDiscard", index: 0 }).state;
    expect(legalActions(state, 4)).toContainEqual({ type: "proposeVeto" });
  });

  it("reshuffles when chaos leaves fewer than three tiles", () => {
    const discard = remainingTiles(0, 0).slice(0, 14);
    const state = makeState({ tracker: 2, deck: ["F", "F", "F"], discard });
    // deck(3) + discard(14) = 17 tiles; chaos takes one, leaving 2 → reshuffle into 16.
    const { state: next, events } = failElection(state, 3);
    expect(events).toContainEqual({ type: "deckReshuffled", deckCount: 16 });
    expect(next.deck).toHaveLength(16);
    expect(next.discard).toEqual([]);
  });
});
