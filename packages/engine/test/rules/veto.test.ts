import { describe, expect, it } from "vitest";

import { legalActions } from "../../src/legal";
import { act, elect, eventTypes, makeState, rejects, remainingTiles } from "../helpers/builders";

/** A Chancellor (seat 4) holding two policies, with `fascist` policies on the board. */
function chancellorPhase(fascist: number, tracker = 0, deck = remainingTiles(0, fascist)) {
  let state = makeState({ playerCount: 7, president: 1, fascist, tracker, deck });
  state = elect(state, 4).state;
  return act(state, 1, { type: "presidentDiscard", index: 0 }).state;
}

describe("veto power", () => {
  it("is unavailable before the 5th fascist policy", () => {
    const state = chancellorPhase(4);
    rejects(state, 4, { type: "proposeVeto" }, "VETO_UNAVAILABLE");
    expect(legalActions(state, 4)).not.toContainEqual({ type: "proposeVeto" });
  });

  it("can be proposed by the Chancellor once 5 fascist policies are enacted", () => {
    const state = chancellorPhase(5);
    expect(legalActions(state, 4)).toContainEqual({ type: "proposeVeto" });
    rejects(state, 1, { type: "proposeVeto" }, "NOT_YOUR_TURN");
    const { state: next, events } = act(state, 4, { type: "proposeVeto" });
    expect(next.phase).toMatchObject({ kind: "vetoResponse", chancellor: 4 });
    expect(events).toEqual([{ type: "vetoProposed", chancellor: 4 }]);
  });

  it("if the President refuses, the Chancellor must enact and cannot ask again", () => {
    let state = act(chancellorPhase(5), 4, { type: "proposeVeto" }).state;
    rejects(state, 4, { type: "respondVeto", agree: false }, "NOT_YOUR_TURN");
    const refused = act(state, 1, { type: "respondVeto", agree: false });
    state = refused.state;
    expect(refused.events).toEqual([{ type: "vetoResponded", president: 1, agree: false }]);
    expect(state.phase).toMatchObject({ kind: "chancellorEnact", vetoRefused: true });
    rejects(state, 4, { type: "proposeVeto" }, "VETO_UNAVAILABLE");
    expect(legalActions(state, 4)).toEqual([
      { type: "chancellorEnact", index: 0 },
      { type: "chancellorEnact", index: 1 },
    ]);
    act(state, 4, { type: "chancellorEnact", index: 0 });
  });

  it("if the President agrees, both policies are discarded and the tracker advances", () => {
    const state = act(chancellorPhase(5), 4, { type: "proposeVeto" }).state;
    const discardBefore = state.discard.length;
    const { state: next, events } = act(state, 1, { type: "respondVeto", agree: true });
    expect(next.discard.length).toBe(discardBefore + 2);
    expect(next.tracker).toBe(1);
    expect(next.fascist).toBe(5);
    expect(next.phase).toEqual({ kind: "nominate" });
    expect(next.president).toBe(2);
    expect(eventTypes(events)).toEqual(["vetoResponded", "trackerAdvanced", "roundStarted"]);
  });

  it("an agreed veto can trigger chaos", () => {
    const deck = ["L" as const, "F" as const, "F" as const, "F" as const, ...remainingTiles(1, 8)];
    const state = act(chancellorPhase(5, 2, deck), 4, { type: "proposeVeto" }).state;
    const { state: next } = act(state, 1, { type: "respondVeto", agree: true });
    // The next tile (F) is enacted by chaos: 6th fascist policy.
    expect(next.phase).toEqual({ kind: "over", winner: "fascist", reason: "fascistPolicies" });
  });

  it("reshuffles before chaos when the pile ran low", () => {
    const deck = ["L" as const, "F" as const, "F" as const];
    const discard = remainingTiles(1, 7);
    const state = act(chancellorPhase(5, 2, deck), 4, { type: "proposeVeto" }).state;
    const { events } = act({ ...state, discard: [...state.discard, ...discard] }, 1, {
      type: "respondVeto",
      agree: true,
    });
    const types = eventTypes(events);
    expect(types.indexOf("deckReshuffled")).toBeLessThan(types.indexOf("trackerAdvanced"));
  });

  it("respondVeto outside a veto is the wrong phase", () => {
    rejects(chancellorPhase(5), 1, { type: "respondVeto", agree: true }, "WRONG_PHASE");
  });
});
