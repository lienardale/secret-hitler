import { describe, expect, it } from "vitest";

import { powerBoard } from "../../src/constants";
import { legalActions } from "../../src/legal";
import type { GameState, PlayerCount, Power } from "../../src/types";
import { viewFor } from "../../src/view";
import {
  act,
  eventTypes,
  failElection,
  governAndEnact,
  makeState,
  rejects,
  remainingTiles,
} from "../helpers/builders";

/** A state where the President (seat 1) must use `power`. */
function powerState(
  power: Power,
  overrides: Partial<GameState> = {},
  playerCount: PlayerCount = 7,
): GameState {
  return {
    ...makeState({ playerCount, president: 1 }),
    phase: { kind: "executive", power, peek: null },
    ...overrides,
  };
}

describe("fascist board powers", () => {
  const expected: Record<string, (Power | null)[]> = {
    5: [null, null, "peek", "execute", "execute"],
    7: [null, "investigate", "specialElection", "execute", "execute"],
    9: ["investigate", "investigate", "specialElection", "execute", "execute"],
  };

  it.each([5, 6, 7, 8, 9, 10] as const)(
    "follow the official board for %i players",
    (playerCount) => {
      const board = expected[playerCount <= 6 ? 5 : playerCount <= 8 ? 7 : 9];
      expect(powerBoard(playerCount)).toEqual(board);
      for (let fascist = 0; fascist < 5; fascist++) {
        const deck = ["F" as const, "F" as const, "F" as const, ...remainingTiles(0, fascist + 3)];
        const state = makeState({ playerCount, fascist, president: 1, deck });
        const { state: next } = governAndEnact(state, 2, "F");
        const power = board?.[fascist] ?? null;
        expect(next.phase.kind).toBe(power ? "executive" : "nominate");
        if (next.phase.kind === "executive") expect(next.phase.power).toBe(power);
      }
    },
  );

  it("the 6th fascist policy wins the game", () => {
    const state = makeState({ fascist: 5, president: 1, deck: ["F", "F", "F", "L"] });
    expect(governAndEnact(state, 2, "F").state.phase).toEqual({
      kind: "over",
      winner: "fascist",
      reason: "fascistPolicies",
    });
  });

  it("a power must match the one granted", () => {
    const state = powerState("execute");
    rejects(state, 1, { type: "investigate", target: 3 }, "WRONG_PHASE");
    rejects(state, 1, { type: "acknowledgePeek" }, "WRONG_PHASE");
    rejects(state, 1, { type: "specialElection", target: 3 }, "WRONG_PHASE");
    rejects(powerState("peek"), 1, { type: "execute", target: 3 }, "WRONG_PHASE");
    rejects(state, 2, { type: "execute", target: 3 }, "NOT_YOUR_TURN");
    rejects(powerState("investigate"), 2, { type: "investigate", target: 3 }, "NOT_YOUR_TURN");
    rejects(
      powerState("specialElection"),
      2,
      { type: "specialElection", target: 3 },
      "NOT_YOUR_TURN",
    );
  });
});

describe("Policy Peek", () => {
  it("shows the President the top three policies without changing the pile", () => {
    const deck = [
      "F" as const,
      "F" as const,
      "F" as const,
      "F" as const,
      "L" as const,
      "F" as const,
      ...remainingTiles(1, 7),
    ];
    const state = makeState({ playerCount: 5, fascist: 2, president: 1, deck });
    const { state: next, events } = governAndEnact(state, 2, "F");
    // In pile order, not sorted: "without changing the order" (the next chaos enacts the first).
    expect(next.phase).toEqual({ kind: "executive", power: "peek", peek: ["F", "L", "F"] });
    expect(next.deck.slice(0, 3)).toEqual(["F", "L", "F"]);
    expect(events.at(-1)).toEqual({
      type: "peekRevealed",
      president: 1,
      policies: ["F", "L", "F"],
    });
    expect(viewFor(next, 1).me?.peek).toEqual(["F", "L", "F"]);
    expect(viewFor(next, 2).me?.peek).toBeNull();
    expect(legalActions(next, 1)).toEqual([{ type: "acknowledgePeek" }]);

    rejects(next, 2, { type: "acknowledgePeek" }, "NOT_YOUR_TURN");
    const { state: after } = act(next, 1, { type: "acknowledgePeek" });
    expect(after.deck).toEqual(next.deck);
    expect(after.phase).toEqual({ kind: "nominate" });
    expect(after.president).toBe(2);
  });
});

describe("Investigate Loyalty", () => {
  it("reveals the party (Hitler shows Fascist) to the President only", () => {
    const { state, events } = act(powerState("investigate"), 1, { type: "investigate", target: 0 });
    expect(state.investigations).toEqual([{ by: 1, target: 0, party: "fascist" }]);
    expect(state.investigated[0]).toBe(true);
    expect(events).toEqual([
      { type: "playerInvestigated", president: 1, target: 0 },
      { type: "investigationResult", president: 1, target: 0, party: "fascist" },
      { type: "roundStarted", president: 2, special: false },
    ]);
    expect(viewFor(state, 1).me?.investigations).toEqual([{ target: 0, party: "fascist" }]);
    expect(viewFor(state, 3).me?.investigations).toEqual([]);
    expect(viewFor(state, 3).seats[0]?.investigated).toBe(true);
  });

  it("no player may be investigated twice, and the President cannot investigate themselves", () => {
    const investigated = [true, false, false, false, false, false, false];
    const state = powerState("investigate", { investigated });
    rejects(state, 1, { type: "investigate", target: 0 }, "ALREADY_INVESTIGATED");
    rejects(state, 1, { type: "investigate", target: 1 }, "INVALID_TARGET");
    expect(legalActions(state, 1).map((a) => ("target" in a ? a.target : -1))).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  it("dead players cannot be investigated", () => {
    const alive = [true, true, true, true, true, true, false];
    rejects(
      powerState("investigate", { alive }),
      1,
      { type: "investigate", target: 6 },
      "INVALID_TARGET",
    );
  });
});

describe("Special Election", () => {
  it("lets the President pick any other player, even a term-limited one", () => {
    const state = powerState("specialElection", { lastElected: { president: 1, chancellor: 4 } });
    rejects(state, 1, { type: "specialElection", target: 1 }, "INVALID_TARGET");
    const { state: next, events } = act(state, 1, { type: "specialElection", target: 4 });
    expect(next.president).toBe(4);
    expect(next.rotationSeat).toBe(1);
    expect(next.phase).toEqual({ kind: "nominate" });
    expect(eventTypes(events)).toEqual(["specialElectionCalled", "roundStarted"]);
    expect(events[1]).toEqual({ type: "roundStarted", president: 4, special: true });
  });

  it("afterwards the presidency returns to the left of the President who called it", () => {
    let state = act(powerState("specialElection"), 1, { type: "specialElection", target: 4 }).state;
    state = failElection(state, 5).state;
    expect(state.president).toBe(2);
  });

  it("picking the next player in rotation gives them two presidencies in a row", () => {
    let state = act(powerState("specialElection"), 1, { type: "specialElection", target: 2 }).state;
    expect(state.president).toBe(2);
    state = failElection(state, 5).state;
    expect(state.president).toBe(2);
  });

  it("if the caller dies during the special round, rotation resumes from their seat", () => {
    const state = powerState("execute", { president: 4, rotationSeat: 1 });
    const { state: next } = act(state, 4, { type: "execute", target: 1 });
    expect(next.president).toBe(2);
  });
});

describe("Execution", () => {
  it("kills a player without revealing their party", () => {
    const { state, events } = act(powerState("execute"), 1, { type: "execute", target: 2 });
    expect(state.alive[2]).toBe(false);
    expect(events[0]).toEqual({ type: "playerExecuted", president: 1, target: 2 });
    expect(JSON.stringify(events)).not.toMatch(/fascist|liberal|hitler/i);
    expect(viewFor(state, 3).roles).toBeNull();
    // The dead seat is skipped in the rotation and cannot act.
    expect(state.president).toBe(3);
    rejects(state, 2, { type: "nominate", target: 4 }, "DEAD_PLAYER");
    expect(legalActions(state, 2)).toEqual([]);
  });

  it("executing Hitler wins the game for the liberals", () => {
    const { state, events } = act(powerState("execute"), 1, { type: "execute", target: 0 });
    expect(state.phase).toEqual({ kind: "over", winner: "liberal", reason: "hitlerExecuted" });
    expect(events.at(-1)).toMatchObject({ type: "gameOver", roles: state.roles });
  });

  it("targets must be other living players", () => {
    const alive = [true, true, true, true, true, true, false];
    const state = powerState("execute", { alive });
    rejects(state, 1, { type: "execute", target: 1 }, "INVALID_TARGET");
    rejects(state, 1, { type: "execute", target: 6 }, "INVALID_TARGET");
    rejects(state, 1, { type: "execute", target: 9 }, "INVALID_TARGET");
    rejects(
      powerState("specialElection", { alive }),
      1,
      { type: "specialElection", target: 6 },
      "INVALID_TARGET",
    );
  });
});
