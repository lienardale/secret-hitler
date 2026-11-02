import { describe, expect, it } from "vitest";

import { DECK_COMPOSITION, ROLE_TABLE } from "../../src/constants";
import { setup } from "../../src/setup";
import type { PlayerCount, Seed } from "../../src/types";

const SEED: Seed = [11, 22, 33, 44];
const COUNTS: PlayerCount[] = [5, 6, 7, 8, 9, 10];

describe("setup", () => {
  it.each(COUNTS)("deals the official roles for %i players", (n) => {
    const { state } = setup(n, SEED);
    const count = (role: string) => state.roles.filter((r) => r === role).length;
    expect(state.roles).toHaveLength(n);
    expect(count("hitler")).toBe(1);
    expect(count("fascist")).toBe(ROLE_TABLE[n].fascist);
    expect(count("liberal")).toBe(ROLE_TABLE[n].liberal);
  });

  it("shuffles a deck of 6 liberal and 11 fascist policies", () => {
    const { state } = setup(7, SEED);
    expect(state.deck).toHaveLength(17);
    expect(state.deck.filter((p) => p === "L")).toHaveLength(DECK_COMPOSITION.L);
    expect(state.discard).toEqual([]);
  });

  it("starts with empty boards, everyone alive, and a random first President", () => {
    const { state, events } = setup(8, SEED);
    expect(state).toMatchObject({ liberal: 0, fascist: 0, tracker: 0, seq: 0, v: 1 });
    expect(state.alive.every(Boolean)).toBe(true);
    expect(state.phase).toEqual({ kind: "nominate" });
    expect(state.president).toBeGreaterThanOrEqual(0);
    expect(state.president).toBeLessThan(8);
    expect(state.rotationSeat).toBe(state.president);
    expect(state.lastElected).toEqual({ president: null, chancellor: null });
    expect(events).toEqual([
      { type: "gameStarted", playerCount: 8, president: state.president },
      { type: "roundStarted", president: state.president, special: false },
    ]);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    expect(setup(9, SEED).state).toEqual(setup(9, SEED).state);
    const others = [1, 2, 3, 4, 5].map((i) => setup(9, [i, 0, 0, 0]).state);
    const distinctDecks = new Set(others.map((s) => s.deck.join("")));
    expect(distinctDecks.size).toBeGreaterThan(1);
  });

  it("first President and Hitler land on every seat over many seeds", () => {
    const presidents = new Set<number>();
    const hitlers = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const { state } = setup(5, [i, i, i, i]);
      presidents.add(state.president);
      hitlers.add(state.roles.indexOf("hitler"));
    }
    expect(presidents.size).toBe(5);
    expect(hitlers.size).toBe(5);
  });

  it.each([4, 11, 0, 7.5, Number.NaN])("refuses %s players", (n) => {
    expect(() => setup(n, SEED)).toThrow(RangeError);
  });
});
