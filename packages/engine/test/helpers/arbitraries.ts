import fc from "fast-check";

import type { PlayerCount } from "../../src/types";

/** Property test runs: 1,000 by default, raised by the nightly job (FC_RUNS=20000). */
export const RUNS = Number(process.env.FC_RUNS ?? 1000);

const uint32 = fc.integer({ min: 0, max: 0xffffffff });

export const gameArb = fc.record({
  playerCount: fc.integer({ min: 5, max: 10 }) as fc.Arbitrary<PlayerCount>,
  seed: fc.tuple(uint32, uint32, uint32, uint32),
  choiceSeed: uint32,
});
