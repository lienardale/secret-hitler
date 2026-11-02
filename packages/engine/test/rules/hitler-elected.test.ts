import { describe, expect, it } from "vitest";

import { viewFor } from "../../src/view";
import { elect, eventTypes, failElection, makeState } from "../helpers/builders";

describe("Hitler elected Chancellor", () => {
  it("after three fascist policies, the fascists win", () => {
    const state = makeState({ playerCount: 7, fascist: 3, president: 1 });
    const { state: next, events } = elect(state, 0); // seat 0 is Hitler
    expect(next.phase).toEqual({ kind: "over", winner: "fascist", reason: "hitlerElected" });
    expect(eventTypes(events).slice(-2)).toEqual(["voteResult", "gameOver"]);
    expect(viewFor(next, 3).roles).toEqual(state.roles);
  });

  it("before three fascist policies, nothing happens", () => {
    const state = makeState({ playerCount: 7, fascist: 2, president: 1 });
    expect(elect(state, 0).state.phase.kind).toBe("presidentDiscard");
  });

  it("any other Chancellor elected after three fascist policies is confirmed not to be Hitler", () => {
    const state = makeState({ playerCount: 7, fascist: 3, president: 1 });
    const { state: next, events } = elect(state, 4);
    expect(next.confirmedNotHitler[4]).toBe(true);
    expect(events).toContainEqual({ type: "chancellorConfirmedNotHitler", seat: 4 });
    expect(viewFor(next, 2).seats[4]?.confirmedNotHitler).toBe(true);
  });

  it("a rejected Hitler nomination does not end the game", () => {
    const state = makeState({ playerCount: 7, fascist: 3, president: 1 });
    expect(failElection(state, 0).state.phase.kind).toBe("nominate");
  });
});
