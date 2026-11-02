import { describe, expect, it } from "vitest";

import { eligibleChancellors, isEligibleChancellor, isTermLimited } from "../../src/eligibility";
import { legalActions } from "../../src/legal";
import { act, failElection, governAndEnact, makeState, rejects } from "../helpers/builders";

describe("term limits", () => {
  it("the last elected President and Chancellor cannot be nominated", () => {
    let state = makeState({ playerCount: 7, president: 1 });
    state = governAndEnact(state, 3, "L").state; // government 1 + 3
    expect(state.president).toBe(2);
    expect(isTermLimited(state, 1)).toBe(true);
    expect(isTermLimited(state, 3)).toBe(true);
    rejects(state, 2, { type: "nominate", target: 1 }, "INELIGIBLE_CHANCELLOR");
    rejects(state, 2, { type: "nominate", target: 3 }, "INELIGIBLE_CHANCELLOR");
    expect(eligibleChancellors(state)).toEqual([0, 4, 5, 6]);
  });

  it("failed elections do not change who is term-limited", () => {
    let state = makeState({ playerCount: 7, president: 1 });
    state = governAndEnact(state, 3, "L").state;
    state = failElection(state, 4).state;
    expect(state.lastElected).toEqual({ president: 1, chancellor: 3 });
    expect(state.president).toBe(3);
    rejects(state, 3, { type: "nominate", target: 1 }, "INELIGIBLE_CHANCELLOR");
  });

  it("with five players alive only the last Chancellor is term-limited", () => {
    const state = makeState({
      playerCount: 5,
      president: 2,
      lastElected: { president: 1, chancellor: 3 },
    });
    expect(isEligibleChancellor(state, 1)).toBe(true);
    expect(isEligibleChancellor(state, 3)).toBe(false);
    act(state, 2, { type: "nominate", target: 1 });
  });

  it.each([5, 4, 3])("relaxes the President limit with %i alive in a larger game", (aliveCount) => {
    const alive = [true, true, true, true, true, true, true].map((_, i) => i < aliveCount);
    const state = makeState({
      playerCount: 7,
      alive,
      president: 0,
      lastElected: { president: 1, chancellor: 2 },
    });
    expect(isTermLimited(state, 1)).toBe(false);
    expect(isTermLimited(state, 2)).toBe(true);
  });

  it("with six players alive both limits apply", () => {
    const alive = [true, true, true, true, true, true, false];
    const state = makeState({
      playerCount: 7,
      alive,
      president: 0,
      lastElected: { president: 1, chancellor: 2 },
    });
    expect(isTermLimited(state, 1)).toBe(true);
  });

  it("the President, dead players and unknown seats cannot be nominated", () => {
    const alive = [true, true, true, true, true, true, false];
    const state = makeState({ playerCount: 7, alive, president: 1 });
    rejects(state, 1, { type: "nominate", target: 1 }, "INVALID_TARGET");
    rejects(state, 1, { type: "nominate", target: 6 }, "INVALID_TARGET");
    rejects(state, 1, { type: "nominate", target: 7 }, "INVALID_TARGET");
    rejects(state, 1, { type: "nominate", target: -1 }, "INVALID_TARGET");
    rejects(state, 1, { type: "nominate", target: 2.5 }, "INVALID_TARGET");
    expect(legalActions(state, 1).map((a) => (a.type === "nominate" ? a.target : -1))).toEqual([
      0, 2, 3, 4, 5,
    ]);
  });

  it("a nomination opens a vote for every living player", () => {
    const state = makeState({ playerCount: 7, president: 1 });
    const { state: next, events } = act(state, 1, { type: "nominate", target: 4 });
    expect(next.phase).toEqual({ kind: "vote", nominee: 4, votes: Array(7).fill(null) });
    expect(events).toEqual([{ type: "chancellorNominated", president: 1, nominee: 4 }]);
  });
});
