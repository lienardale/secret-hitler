import { describe, expect, it } from "vitest";

import { defaultAction } from "../../src/defaults";
import { legalActions } from "../../src/legal";
import type { GameState } from "../../src/types";
import { act, makeState } from "../helpers/builders";

const always = (value: number) => () => value;

describe("defaultAction (timeouts)", () => {
  it("votes Nein", () => {
    const vote = act(makeState({ president: 1 }), 1, { type: "nominate", target: 3 }).state;
    expect(defaultAction(vote, 5, always(0))).toEqual({ type: "vote", ja: false });
  });

  it("refuses a veto", () => {
    const veto: GameState = {
      ...makeState({ president: 1, fascist: 5 }),
      phase: { kind: "vetoResponse", chancellor: 3, hand: ["F", "F"] },
    };
    expect(defaultAction(veto, 1, always(0))).toEqual({ type: "respondVeto", agree: false });
  });

  it("never proposes a veto", () => {
    const enact: GameState = {
      ...makeState({ president: 1, fascist: 5 }),
      phase: { kind: "chancellorEnact", chancellor: 3, hand: ["L", "F"], vetoRefused: false },
    };
    expect(legalActions(enact, 3)).toContainEqual({ type: "proposeVeto" });
    expect(defaultAction(enact, 3, always(0.999999))).toEqual({
      type: "chancellorEnact",
      index: 1,
    });
  });

  it("picks a random legal choice otherwise", () => {
    const state = makeState({ president: 1 });
    expect(defaultAction(state, 1, always(0))).toEqual({ type: "nominate", target: 0 });
    expect(defaultAction(state, 1, always(0.99))).toEqual({ type: "nominate", target: 6 });
    // rand() returning exactly 1 (out of contract) still yields a legal action.
    expect(defaultAction(state, 1, always(1))).toEqual({ type: "nominate", target: 6 });
  });

  it("returns null when the seat has nothing to do", () => {
    expect(defaultAction(makeState({ president: 1 }), 2, always(0))).toBeNull();
  });
});
