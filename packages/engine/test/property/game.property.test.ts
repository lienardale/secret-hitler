/**
 * Property tests: thousands of random games, played with random legal actions,
 * must never break the rules' structural invariants.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { apply } from "../../src/apply";
import { checkInvariants } from "../../src/invariants";
import { legalActions } from "../../src/legal";
import { replay } from "../../src/replay";
import { playRandomGame, seededRandom } from "../../src/simulate";
import type { Action, GameState } from "../../src/types";
import { viewFor } from "../../src/view";
import { RUNS, gameArb } from "../helpers/arbitraries";

describe("random games", () => {
  it("keep every invariant and always end", () => {
    fc.assert(
      fc.property(gameArb, ({ playerCount, seed, choiceSeed }) => {
        const { state, violations, moves } = playRandomGame(
          playerCount,
          seed,
          seededRandom(choiceSeed),
          {
            checkInvariants: true,
            maxActions: 1000,
          },
        );
        expect(violations).toEqual([]);
        expect(state.phase.kind).toBe("over");
        expect(moves.length).toBeLessThan(1000);
      }),
      { numRuns: RUNS },
    );
  });

  it("end with a winner consistent with the board", () => {
    fc.assert(
      fc.property(gameArb, ({ playerCount, seed, choiceSeed }) => {
        const { state } = playRandomGame(playerCount, seed, seededRandom(choiceSeed));
        if (state.phase.kind !== "over") throw new Error("game did not end");
        const hitler = state.roles.indexOf("hitler");
        switch (state.phase.reason) {
          case "liberalPolicies":
            expect(state.liberal).toBe(5);
            break;
          case "fascistPolicies":
            expect(state.fascist).toBe(6);
            break;
          case "hitlerExecuted":
            expect(state.alive[hitler]).toBe(false);
            break;
          case "hitlerElected":
            expect(state.fascist).toBeGreaterThanOrEqual(3);
            expect(state.lastElected.chancellor).toBe(hitler);
            break;
        }
        const liberalWin =
          state.phase.reason === "liberalPolicies" || state.phase.reason === "hitlerExecuted";
        expect(state.phase.winner).toBe(liberalWin ? "liberal" : "fascist");
      }),
      { numRuns: RUNS },
    );
  });

  it("replay to the same state from the seed and the moves", () => {
    fc.assert(
      fc.property(gameArb, ({ playerCount, seed, choiceSeed }) => {
        const { state, moves } = playRandomGame(playerCount, seed, seededRandom(choiceSeed));
        expect(replay(playerCount, seed, moves)).toEqual(state);
      }),
      { numRuns: Math.ceil(RUNS / 5) },
    );
  });

  it("keep states small and views free of secret fields", () => {
    fc.assert(
      fc.property(gameArb, ({ playerCount, seed, choiceSeed }) => {
        let largest = 0;
        playRandomGame(playerCount, seed, seededRandom(choiceSeed), {
          onStep: (state) => {
            largest = Math.max(largest, JSON.stringify(state).length);
            if (state.phase.kind === "over") return;
            // Completed ballots (lastVote) are public; open ballots, cards and roles are not.
            const view = viewFor(state, "spectator");
            expect(JSON.stringify(view)).not.toMatch(
              /"(deck|discard|rng|roles|hand|peek|investigations)":\[/,
            );
            expect(JSON.stringify(view.phase)).not.toContain("votes");
          },
        });
        expect(largest).toBeLessThan(100_000);
      }),
      { numRuns: Math.ceil(RUNS / 5) },
    );
  });
});

/** Every action shape the engine knows, with in- and out-of-range arguments. */
function candidateActions(playerCount: number): Action[] {
  const seats = Array.from({ length: playerCount + 2 }, (_, i) => i - 1);
  const indices = [-1, 0, 1, 2, 3];
  return [
    ...seats.map((target): Action => ({ type: "nominate", target })),
    { type: "vote", ja: true },
    { type: "vote", ja: false },
    ...indices.map((index): Action => ({ type: "presidentDiscard", index })),
    ...indices.map((index): Action => ({ type: "chancellorEnact", index })),
    { type: "proposeVeto" },
    { type: "respondVeto", agree: true },
    { type: "respondVeto", agree: false },
    ...seats.map((target): Action => ({ type: "investigate", target })),
    { type: "acknowledgePeek" },
    ...seats.map((target): Action => ({ type: "specialElection", target })),
    ...seats.map((target): Action => ({ type: "execute", target })),
  ];
}

describe("legalActions", () => {
  it("lists exactly the actions apply() accepts", () => {
    fc.assert(
      fc.property(
        gameArb,
        fc.integer({ min: 0, max: 400 }),
        ({ playerCount, seed, choiceSeed }, stop) => {
          // Stop a random game somewhere in the middle and probe every seat with every action.
          let probe: GameState | null = null;
          let steps = 0;
          playRandomGame(playerCount, seed, seededRandom(choiceSeed), {
            onStep: (state) => {
              steps += 1;
              if (steps === stop || (probe === null && state.phase.kind !== "over")) probe = state;
            },
          });
          const state = probe as GameState | null;
          if (state === null) return;
          const candidates = candidateActions(playerCount);
          for (let seat = 0; seat < playerCount; seat++) {
            const legal = legalActions(state, seat).map((a) => JSON.stringify(a));
            for (const action of candidates) {
              const accepted = apply(state, { seat, action }).ok;
              expect(accepted, `${seat} ${JSON.stringify(action)}`).toBe(
                legal.includes(JSON.stringify(action)),
              );
            }
          }
          expect(checkInvariants(state)).toEqual([]);
        },
      ),
      { numRuns: Math.ceil(RUNS / 4) },
    );
  });
});
