import type { Ctx } from "./context";
import { shuffle } from "./rng";
import type { Policy } from "./types";

/** Canonical order for a set of policies: Liberal first. Hands carry no deck-order information. */
export function sortPolicies(policies: readonly Policy[]): Policy[] {
  return policies.slice().sort((a, b) => (a === b ? 0 : a === "L" ? -1 : 1));
}

/**
 * When fewer than three tiles remain in the draw pile, the remaining tiles are
 * shuffled together with the discard pile to form the new draw pile. Checked at
 * the end of every legislative session and after chaos.
 */
export function ensureDeck({ s, events }: Ctx): void {
  if (s.deck.length >= 3) return;
  const shuffled = shuffle(s.rng, [...s.deck, ...s.discard]);
  s.deck = shuffled.items;
  s.rng = shuffled.state;
  s.discard = [];
  events.push({ type: "deckReshuffled", deckCount: s.deck.length });
}

/** Take the top `count` policies off the draw pile. */
export function draw({ s }: Ctx, count: number): Policy[] {
  /* c8 ignore next 3 -- guarded by ensureDeck: the pile always holds 3+ tiles when drawing */
  if (s.deck.length < count) {
    throw new Error(`draw: ${count} requested, ${s.deck.length} left`);
  }
  return s.deck.splice(0, count);
}
