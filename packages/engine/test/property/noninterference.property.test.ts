/**
 * Hidden-information tests. A player's view must not depend on anything that
 * player is not allowed to know: changing a secret they cannot see must leave
 * their view byte-for-byte identical.
 *
 *  (a) shuffling the remaining draw pile;
 *  (b) swapping the roles of two seats whose roles the viewer does not know
 *      (not revealed to them at night, not investigated by them).
 *
 * Spectators know no role at all, so any swap must leave their view unchanged.
 *
 * The one sanctioned look at the pile is the Policy Peek: the President sees
 * the top three in pile order. The peek is captured in the phase when the power
 * is granted, so reshuffling the pile afterwards changes nobody's view; the
 * peek matching the pile's order is checked in game.property.test.ts, and the
 * peek reaching only the President in the test below (`peek` is null in every
 * other view, and spectators never see one).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { knownRoles } from "../../src/knowledge";
import { playRandomGame, seededRandom } from "../../src/simulate";
import type { GameState, Seat } from "../../src/types";
import { viewFor, type Viewer } from "../../src/view";
import { RUNS, gameArb } from "../helpers/arbitraries";

function shuffledDeck(state: GameState, rand: () => number): GameState {
  const deck = state.deck.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return { ...state, deck };
}

function swappedRoles(state: GameState, a: Seat, b: Seat): GameState {
  const roles = state.roles.slice();
  [roles[a], roles[b]] = [roles[b]!, roles[a]!];
  return { ...state, roles };
}

/** Seats whose role `viewer` does not know. */
function unknownSeats(state: GameState, viewer: Viewer): Seat[] {
  const seats = state.roles.map((_, seat) => seat);
  if (viewer === "spectator") return seats;
  const known = new Set(knownRoles(state, viewer).map((k) => k.seat));
  for (const inv of state.investigations) if (inv.by === viewer) known.add(inv.target);
  return seats.filter((seat) => !known.has(seat));
}

describe("non-interference", () => {
  it("no view depends on a secret its viewer cannot see", () => {
    fc.assert(
      fc.property(
        gameArb,
        fc.integer({ min: 0, max: 0xffffffff }),
        ({ playerCount, seed, choiceSeed }, tweakSeed) => {
          const rand = seededRandom(tweakSeed);
          let step = 0;
          playRandomGame(playerCount, seed, seededRandom(choiceSeed), {
            onStep: (state) => {
              step += 1;
              if (state.phase.kind === "over" || step % 3 !== 0) return;
              const viewers: Viewer[] = ["spectator", ...state.roles.map((_, seat) => seat)];
              const reshuffled = shuffledDeck(state, rand);

              for (const viewer of viewers) {
                const view = viewFor(state, viewer);
                if (view.me && view.me.seat !== state.president) expect(view.me.peek).toBeNull();
                const original = JSON.stringify(view);
                expect(
                  JSON.stringify(viewFor(reshuffled, viewer)),
                  `deck order leaked to ${viewer}`,
                ).toBe(original);

                const unknown = unknownSeats(state, viewer);
                if (unknown.length < 2) continue;
                const a = unknown[Math.floor(rand() * unknown.length)]!;
                const others = unknown.filter((s) => s !== a);
                const b = others[Math.floor(rand() * others.length)]!;
                expect(
                  JSON.stringify(viewFor(swappedRoles(state, a, b), viewer)),
                  `roles of ${a}/${b} leaked to ${viewer}`,
                ).toBe(original);
              }
            },
          });
        },
      ),
      { numRuns: Math.ceil(RUNS / 5) },
    );
  });
});
