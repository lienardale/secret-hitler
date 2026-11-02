import { TRACKER_LIMIT } from "../constants";
import type { Ctx } from "../context";
import type { Policy } from "../types";
import { draw, ensureDeck } from "../deck";
import { startNextRound } from "../rotation";
import { placePolicy } from "./end";

/**
 * A failed election, or an agreed veto, moves the election tracker. On the
 * third step the country is thrown into chaos.
 */
export function advanceTracker(ctx: Ctx): void {
  const { s, events } = ctx;
  s.tracker += 1;
  events.push({ type: "trackerAdvanced", tracker: s.tracker });
  if (s.tracker >= TRACKER_LIMIT) enactChaos(ctx);
  else startNextRound(ctx);
}

/**
 * Chaos: the top policy is enacted at once. Its power is ignored, there is no
 * Hitler check (nobody was elected), term limits are forgotten and the tracker
 * resets. It can still win the game, and a 5th fascist policy unlocks the veto.
 */
function enactChaos(ctx: Ctx): void {
  const policy = draw(ctx, 1)[0] as Policy;
  ctx.s.lastElected = { president: null, chancellor: null };
  if (placePolicy(ctx, policy, true)) return;
  ensureDeck(ctx);
  startNextRound(ctx);
}
