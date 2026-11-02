import { describe, expect, it } from "vitest";

import { checkInvariants } from "../../src/invariants";
import { STATE_VERSION, migrate } from "../../src/migrate";
import { replay } from "../../src/replay";
import { setup } from "../../src/setup";
import { playRandomGame, seededRandom } from "../../src/simulate";
import type { GameState } from "../../src/types";
import { makeState } from "../helpers/builders";

describe("migrate", () => {
  it("accepts the current version and refuses anything else", () => {
    const state = makeState();
    expect(migrate(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(STATE_VERSION).toBe(1);
    for (const raw of [null, 3, {}, { v: 2 }]) expect(() => migrate(raw)).toThrow(/unsupported/);
  });
});

describe("replay", () => {
  it("throws when a move is rejected", () => {
    expect(() =>
      replay(5, [1, 2, 3, 4], [{ seat: 0, action: { type: "acknowledgePeek" } }]),
    ).toThrow(/move 0/);
  });
});

describe("playRandomGame", () => {
  it("reports a game that runs past maxActions", () => {
    const result = playRandomGame(7, [1, 2, 3, 4], seededRandom(1), { maxActions: 3 });
    expect(result.violations).toEqual(["game did not end within 3 actions"]);
    expect(result.moves).toHaveLength(3);
  });

  it("reports invariant violations found during play", () => {
    let corrupted = false;
    const result = playRandomGame(7, [5, 6, 7, 8], seededRandom(3), {
      checkInvariants: true,
      onStep: (state) => {
        if (corrupted) return;
        corrupted = true;
        state.tracker = 7; // impossible value, checked right after this hook
      },
    });
    expect(result.violations[0]).toBe("after move 1: tracker out of range: 7");
  });

  it("calls onStep after each accepted move", () => {
    let steps = 0;
    const result = playRandomGame(5, [4, 3, 2, 1], seededRandom(2), { onStep: () => (steps += 1) });
    expect(steps).toBe(result.moves.length);
    expect(result.state.phase.kind).toBe("over");
  });
});

describe("checkInvariants", () => {
  it("accepts a fresh game", () => {
    expect(checkInvariants(setup(7, [1, 2, 3, 4]).state)).toEqual([]);
  });

  it("detects broken states", () => {
    const base = makeState();
    const cases: [Partial<GameState>, RegExp][] = [
      [{ deck: base.deck.slice(1) }, /card count/],
      [{ deck: [...base.deck.slice(0, -1), "L"] }, /liberal tile count/],
      [{ roles: base.roles.map((r) => (r === "hitler" ? "liberal" : r)) }, /exactly one Hitler/],
      [{ roles: base.roles.map((r, i) => (i === 1 ? "liberal" : r)) }, /fascists/],
      [{ roles: base.roles.map((r, i) => (i === 6 ? "fascist" : r)) }, /liberals/],
      [{ roles: [...base.roles, "liberal"] }, /roles length/],
      [{ tracker: 3 }, /tracker/],
      [{ liberal: 6, deck: base.deck.slice(6) }, /too many liberal/],
      [{ fascist: 7, deck: base.deck.slice(0, 10) }, /too many fascist/],
      [{ liberal: 5, deck: base.deck.slice(5) }, /policy track is full/],
      [{ alive: [true, true, false, false, false, true, true] }, /more than two/],
      [{ alive: [true, false, true, true, true, true, true] }, /President is dead/],
      [{ confirmedNotHitler: [true, false, false, false, false, false, false] }, /confirmed not/],
      [{ alive: [false, true, true, true, true, true, true] }, /Hitler is dead/],
      [{ deck: base.deck.slice(0, 2), discard: base.deck.slice(2) }, /draw pile/],
    ];
    for (const [overrides, pattern] of cases) {
      expect(checkInvariants({ ...base, ...overrides }).join("; ")).toMatch(pattern);
    }
  });

  it("detects a stuck game", () => {
    // Everyone has voted but the vote was never resolved: nobody can act.
    const stuck: GameState = {
      ...makeState(),
      phase: { kind: "vote", nominee: 3, votes: Array<boolean>(7).fill(true) },
    };
    expect(checkInvariants(stuck).join()).toMatch(/nobody can act/);
    // Only seat 1 (President) and seat 2 are alive besides the term-limited: no candidate.
    const alive = [true, true, true, true, true, false, false];
    const noCandidate: GameState = {
      ...makeState({ playerCount: 7, alive, president: 1 }),
      alive: [false, true, true, false, false, false, false],
      lastElected: { president: null, chancellor: 2 },
    };
    expect(checkInvariants(noCandidate).join()).toMatch(/no eligible Chancellor/);
  });
});
