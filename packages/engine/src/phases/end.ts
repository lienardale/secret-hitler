import { FASCIST_POLICIES_TO_WIN, LIBERAL_POLICIES_TO_WIN } from "../constants";
import type { Ctx } from "../context";
import type { Party, Policy, WinReason } from "../types";

export function endGame({ s, events }: Ctx, winner: Party, reason: WinReason): void {
  s.phase = { kind: "over", winner, reason };
  events.push({ type: "gameOver", winner, reason, roles: s.roles.slice() });
}

/**
 * Put a policy on its board. Any enacted policy resets the election tracker.
 * Returns true when it wins the game (5th liberal or 6th fascist policy).
 */
export function placePolicy(ctx: Ctx, policy: Policy, byChaos: boolean): boolean {
  const { s, events } = ctx;
  if (policy === "L") s.liberal += 1;
  else s.fascist += 1;
  s.tracker = 0;
  events.push({ type: "policyEnacted", policy, byChaos });

  if (s.liberal >= LIBERAL_POLICIES_TO_WIN) {
    endGame(ctx, "liberal", "liberalPolicies");
    return true;
  }
  if (s.fascist >= FASCIST_POLICIES_TO_WIN) {
    endGame(ctx, "fascist", "fascistPolicies");
    return true;
  }
  return false;
}
