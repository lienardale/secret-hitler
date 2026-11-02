import { describe, expect, it } from "vitest";

import { apply } from "../../src/apply";
import { legalActions, pendingActors } from "../../src/legal";
import { outcome } from "../../src/outcome";
import type { Action, GameState } from "../../src/types";
import { act, deepFreeze, makeState, rejects } from "../helpers/builders";

const EVERY_ACTION: Action[] = [
  { type: "nominate", target: 3 },
  { type: "vote", ja: true },
  { type: "presidentDiscard", index: 0 },
  { type: "chancellorEnact", index: 0 },
  { type: "proposeVeto" },
  { type: "respondVeto", agree: true },
  { type: "investigate", target: 3 },
  { type: "acknowledgePeek" },
  { type: "specialElection", target: 3 },
  { type: "execute", target: 3 },
];

describe("action validation", () => {
  it("rejects every action once the game is over", () => {
    const state: GameState = {
      ...makeState(),
      phase: { kind: "over", winner: "liberal", reason: "liberalPolicies" },
    };
    for (const action of EVERY_ACTION) rejects(state, 1, action, "GAME_OVER");
    expect(legalActions(state, 1)).toEqual([]);
    expect(pendingActors(state)).toEqual([]);
    expect(outcome(state)).toEqual({ winner: "liberal", reason: "liberalPolicies" });
    expect(outcome(makeState())).toBeNull();
  });

  it("rejects unknown seats", () => {
    for (const seat of [-1, 7, 1.5, Number.NaN])
      rejects(makeState(), seat, { type: "vote", ja: true }, "INVALID_SEAT");
    expect(legalActions(makeState(), 9)).toEqual([]);
  });

  it("rejects actions that do not belong to the current phase", () => {
    const nominate = makeState({ president: 1 });
    for (const action of EVERY_ACTION.filter((a) => a.type !== "nominate")) {
      rejects(nominate, 1, action, "WRONG_PHASE");
    }
    const vote = act(nominate, 1, { type: "nominate", target: 3 }).state;
    rejects(vote, 1, { type: "nominate", target: 3 }, "WRONG_PHASE");
  });

  it("rejects actions out of turn", () => {
    rejects(makeState({ president: 1 }), 2, { type: "nominate", target: 3 }, "NOT_YOUR_TURN");
  });

  it("rejects malformed payloads", () => {
    const vote = act(makeState({ president: 1 }), 1, { type: "nominate", target: 3 }).state;
    rejects(vote, 2, { type: "vote", ja: "yes" } as unknown as Action, "INVALID_ACTION");
    rejects(vote, 2, { type: "dance" } as unknown as Action, "INVALID_ACTION");
    const veto: GameState = {
      ...makeState({ president: 1 }),
      phase: { kind: "vetoResponse", chancellor: 3, hand: ["F", "F"] },
    };
    rejects(veto, 1, { type: "respondVeto", agree: 1 } as unknown as Action, "INVALID_ACTION");
  });

  it("never modifies the state it is given", () => {
    const state = deepFreeze(makeState({ president: 1 }));
    const result = apply(state, { seat: 1, action: { type: "nominate", target: 3 } });
    expect(result.ok).toBe(true);
    expect(state.phase).toEqual({ kind: "nominate" });
  });

  it("increments seq on success only", () => {
    const state = makeState({ president: 1 });
    expect(act(state, 1, { type: "nominate", target: 3 }).state.seq).toBe(1);
    const failed = apply(state, { seat: 2, action: { type: "nominate", target: 3 } });
    expect(failed.ok).toBe(false);
  });
});
