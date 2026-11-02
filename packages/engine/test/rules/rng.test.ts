import { describe, expect, it } from "vitest";

import { createRng, nextUint32, randomInt, shuffle } from "../../src/rng";

describe("seeded RNG", () => {
  it("is deterministic", () => {
    const a = nextUint32(createRng([1, 2, 3, 4]));
    const b = nextUint32(createRng([1, 2, 3, 4]));
    expect(a).toEqual(b);
    // Changing any single seed word changes the first output.
    for (const seed of [
      [9, 2, 3, 4],
      [1, 9, 3, 4],
      [1, 2, 9, 4],
      [1, 2, 3, 9],
    ] as const) {
      expect(nextUint32(createRng(seed)).value).not.toBe(a.value);
    }
  });

  it("never starts from the all-zero state", () => {
    const state = createRng([0, 0, 0, 0]);
    expect(state.some((w) => w !== 0)).toBe(true);
  });

  it("produces unsigned 32-bit integers", () => {
    let state = createRng([9, 9, 9, 9]);
    for (let i = 0; i < 1000; i++) {
      const next = nextUint32(state);
      expect(Number.isInteger(next.value) && next.value >= 0 && next.value < 2 ** 32).toBe(true);
      state = next.state;
    }
  });

  it("randomInt stays in range, covers it, and rejects bad bounds", () => {
    let state = createRng([5, 6, 7, 8]);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const r = randomInt(state, 6);
      seen.add(r.value);
      state = r.state;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    for (const n of [0, -1, 1.5, 2 ** 32 + 1])
      expect(() => randomInt(state, n)).toThrow(RangeError);
    expect(randomInt(state, 2 ** 32).value).toBeLessThan(2 ** 32);
  });

  it("randomInt rejects values that would bias the result", () => {
    // With n = 3·2^30, a quarter of all 32-bit values are rejected.
    let state = createRng([1, 1, 1, 1]);
    for (let i = 0; i < 64; i++) {
      const r = randomInt(state, 3 * 2 ** 30);
      expect(r.value).toBeLessThan(3 * 2 ** 30);
      state = r.state;
    }
  });

  it("shuffle returns a permutation and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const { items } = shuffle(createRng([3, 1, 4, 1]), input);
    expect(items.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
