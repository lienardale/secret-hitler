import { describe, expect, it } from "vitest";

import { sortPolicies } from "../../src/deck";
import type { Policy } from "../../src/types";
import {
  act,
  elect,
  eventTypes,
  governAndEnact,
  makeState,
  rejects,
  remainingTiles,
} from "../helpers/builders";

describe("legislative session", () => {
  const start = () =>
    elect(
      makeState({ playerCount: 7, president: 1, deck: ["F", "L", "F", ...remainingTiles(1, 2)] }),
      4,
    ).state;

  it("the President discards one policy and hands the other two to the Chancellor at once", () => {
    const { state, events } = act(start(), 1, { type: "presidentDiscard", index: 0 });
    expect(state.phase).toEqual({
      kind: "chancellorEnact",
      chancellor: 4,
      hand: ["F", "F"],
      vetoRefused: false,
    });
    expect(state.discard).toEqual(["L"]);
    expect(events).toEqual([
      { type: "presidentDiscarded", president: 1, policy: "L" },
      { type: "chancellorReceived", chancellor: 4, policies: ["F", "F"] },
    ]);
  });

  it("the Chancellor enacts one and discards the other; the tracker resets", () => {
    let state = act(start(), 1, { type: "presidentDiscard", index: 1 }).state; // keeps L, F
    expect(state.phase).toMatchObject({ hand: ["L", "F"] });
    const { state: next, events } = act({ ...state, tracker: 2 }, 4, {
      type: "chancellorEnact",
      index: 0,
    });
    state = next;
    expect(state.liberal).toBe(1);
    expect(state.tracker).toBe(0);
    expect(state.discard).toEqual(["F", "F"]);
    expect(state.phase).toEqual({ kind: "nominate" });
    expect(state.president).toBe(2);
    expect(eventTypes(events)).toEqual(["chancellorDiscarded", "policyEnacted", "roundStarted"]);
  });

  it("rejects out-of-range choices and the wrong player", () => {
    const state = start();
    for (const index of [3, -1, 1.5])
      rejects(state, 1, { type: "presidentDiscard", index }, "INVALID_INDEX");
    rejects(state, 4, { type: "presidentDiscard", index: 0 }, "NOT_YOUR_TURN");
    const enactPhase = act(state, 1, { type: "presidentDiscard", index: 0 }).state;
    rejects(enactPhase, 4, { type: "chancellorEnact", index: 2 }, "INVALID_INDEX");
    rejects(enactPhase, 1, { type: "chancellorEnact", index: 0 }, "NOT_YOUR_TURN");
  });

  it("hands are sorted, so their order reveals nothing about the deck", () => {
    expect(sortPolicies(["F", "L", "F", "L"])).toEqual(["L", "L", "F", "F"]);
    expect(start().phase).toMatchObject({ hand: ["L", "F", "F"] });
  });

  it("the remaining tiles are shuffled with the discards at the end of the session", () => {
    // Four tiles left: one stays after the draw and joins the discards.
    const discard: Policy[] = [...Array<Policy>(3).fill("L"), ...Array<Policy>(10).fill("F")];
    const state = makeState({ deck: ["L", "L", "L", "F"], discard });
    const { state: next, events } = governAndEnact(state, 3, "L");
    expect(events).toContainEqual({ type: "deckReshuffled", deckCount: 16 });
    expect(next.deck).toHaveLength(16);
    expect(next.discard).toEqual([]);
    expect(next.deck.filter((p) => p === "L")).toHaveLength(5);
  });

  it("the reshuffle happens before a Policy Peek, which sees the new pile", () => {
    // 5 players: the 3rd fascist policy grants Policy Peek. Exactly 3 tiles left.
    const deck = ["F" as const, "F" as const, "L" as const];
    const discard = remainingTiles(0, 2).filter((_, i) => i !== 0 && i !== 6 && i !== 7);
    const state = makeState({ playerCount: 5, fascist: 2, president: 1, deck, discard });
    const { state: next, events } = governAndEnact(state, 3, "F");
    expect(eventTypes(events).slice(-4)).toEqual([
      "policyEnacted",
      "deckReshuffled",
      "powerGranted",
      "peekRevealed",
    ]);
    expect(next.phase).toEqual({
      kind: "executive",
      power: "peek",
      peek: sortPolicies(next.deck.slice(0, 3)),
    });
  });
});
