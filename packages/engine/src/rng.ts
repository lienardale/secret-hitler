/**
 * Seeded, pure random number generator (xoshiro128**), stored in the game
 * state so every game is reproducible from its seed and its list of actions.
 *
 * Every function returns the new RNG state instead of mutating anything.
 */
import type { RngState, Seed } from "./types";

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** splitmix32 step, used to spread a seed over the four state words. */
function splitmix32(x: number): number {
  let z = (x + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** Generator steps discarded after seeding so every output depends on every seed word. */
const WARM_UP_STEPS = 16;

/**
 * Build the generator state from a 128-bit seed. Each word is mixed on its own
 * (a bijection, so no seed entropy is lost: collapsing the seed into a 32-bit
 * hash would let a player brute-force the deal), then the generator runs a few
 * steps so that all four words influence the first output.
 */
export function createRng(seed: Seed): RngState {
  const words = seed.map((word, i) => splitmix32((word >>> 0) ^ Math.imul(i + 1, 0x632be5ab)));
  const [a = 0, b = 0, c = 0, d = 0] = words;
  // xoshiro must never be all zeros.
  let state: RngState = (a | b | c | d) === 0 ? [1, 0, 0, 0] : [a, b, c, d];
  for (let i = 0; i < WARM_UP_STEPS; i++) state = nextUint32(state).state;
  return state;
}

/** Next unsigned 32-bit integer. */
export function nextUint32(state: RngState): { value: number; state: RngState } {
  const [s0, s1, s2, s3] = state;
  const value = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  let n2 = (s2 ^ s0) >>> 0;
  let n3 = (s3 ^ s1) >>> 0;
  const n1 = (s1 ^ n2) >>> 0;
  const n0 = (s0 ^ n3) >>> 0;
  n2 = (n2 ^ t) >>> 0;
  n3 = rotl(n3, 11);
  return { value, state: [n0, n1, n2, n3] };
}

/** Uniform integer in [0, n), without modulo bias. */
export function randomInt(state: RngState, n: number): { value: number; state: RngState } {
  if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) {
    throw new RangeError(`randomInt: n must be an integer in [1, 2^32], got ${n}`);
  }
  const limit = Math.floor(0x100000000 / n) * n;
  let current = state;
  for (;;) {
    const next = nextUint32(current);
    current = next.state;
    if (next.value < limit) return { value: next.value % n, state: current };
  }
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(state: RngState, items: readonly T[]): { items: T[]; state: RngState } {
  const out = items.slice();
  let current = state;
  for (let i = out.length - 1; i > 0; i--) {
    const pick = randomInt(current, i + 1);
    current = pick.state;
    const j = pick.value;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return { items: out, state: current };
}
