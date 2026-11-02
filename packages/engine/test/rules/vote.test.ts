import { describe, expect, it } from "vitest";

import type { Policy } from "../../src/types";
import { viewFor } from "../../src/view";
import { act, elect, eventTypes, makeState, rejects, voteAll } from "../helpers/builders";

describe("elections", () => {
  it("a majority of Ja elects the government and the President draws three policies", () => {
    const state = makeState({
      playerCount: 7,
      president: 1,
      deck: ["F", "L", "F", ...Array<Policy>(14).fill("F")],
    });
    const { state: next, events } = elect(state, 4, (seat) => seat < 4); // 4 Ja of 7
    expect(next.phase).toEqual({ kind: "presidentDiscard", chancellor: 4, hand: ["L", "F", "F"] });
    expect(next.deck).toHaveLength(14);
    expect(next.lastElected).toEqual({ president: 1, chancellor: 4 });
    expect(next.lastVote).toEqual({
      president: 1,
      nominee: 4,
      votes: [true, true, true, true, false, false, false],
      passed: true,
    });
    expect(eventTypes(events).slice(-2)).toEqual(["voteResult", "policiesDrawn"]);
    expect(events.at(-1)).toEqual({
      type: "policiesDrawn",
      president: 1,
      policies: ["L", "F", "F"],
    });
  });

  it("a tie fails", () => {
    const alive = [true, true, true, true, true, true, false];
    const state = makeState({ playerCount: 7, alive, president: 1 });
    const { state: next } = elect(state, 4, (seat) => seat < 3); // 3 Ja, 3 Nein
    expect(next.lastVote?.passed).toBe(false);
    expect(next.lastVote?.votes).toEqual([true, true, true, false, false, false, null]);
    expect(next.tracker).toBe(1);
  });

  it("executed players cannot vote and are not waited for", () => {
    const alive = [true, true, true, true, true, true, false];
    let state = makeState({ playerCount: 7, alive, president: 1 });
    state = act(state, 1, { type: "nominate", target: 2 }).state;
    rejects(state, 6, { type: "vote", ja: true }, "DEAD_PLAYER");
    state = voteAll(state, true).state;
    expect(state.phase.kind).toBe("presidentDiscard");
  });

  it("nobody votes twice", () => {
    let state = makeState({ playerCount: 7, president: 1 });
    state = act(state, 1, { type: "nominate", target: 2 }).state;
    state = act(state, 3, { type: "vote", ja: true }).state;
    rejects(state, 3, { type: "vote", ja: false }, "ALREADY_VOTED");
  });

  it("ballots stay hidden until everyone has voted", () => {
    let state = makeState({ playerCount: 5, president: 1 });
    state = act(state, 1, { type: "nominate", target: 2 }).state;
    const { state: partial, events } = act(state, 3, { type: "vote", ja: false });
    expect(events).toEqual([{ type: "voteCast", seat: 3 }]);
    const view = viewFor(partial, 0);
    expect(view.seats.map((s) => s.hasVoted)).toEqual([false, false, false, true, false]);
    expect(view.lastVote).toBeNull();
    expect(JSON.stringify(view)).not.toContain("votes");

    const done = voteAll(partial, true).state;
    expect(viewFor(done, 0).lastVote?.votes).toEqual([true, true, true, false, true]);
    expect(viewFor(done, 0).seats.every((s) => s.hasVoted === null)).toBe(true);
  });
});
