import type { Ctx } from "../context";
import { engineError } from "../errors";
import { partyOf } from "../knowledge";
import { startNextRound } from "../rotation";
import type { EngineError, Role, Seat } from "../types";
import { endGame } from "./end";
import { isSeat } from "./guards";

/** Powers target another living player. */
function validTarget(ctx: Ctx, target: Seat): boolean {
  const { s } = ctx;
  return isSeat(s, target) && s.alive[target] === true && target !== s.president;
}

const invalidTarget = (): EngineError =>
  engineError("INVALID_TARGET", "Choose another living player.");

/** Investigate Loyalty: the President learns the target's party (Hitler shows Fascist). */
export function investigate(ctx: Ctx, target: Seat): EngineError | undefined {
  const { s, events } = ctx;
  if (!validTarget(ctx, target)) return invalidTarget();
  if (s.investigated[target]) {
    return engineError("ALREADY_INVESTIGATED", "No player may be investigated twice.");
  }
  const party = partyOf(s.roles[target] as Role);
  s.investigated[target] = true;
  s.investigations.push({ by: s.president, target, party });
  events.push({ type: "playerInvestigated", president: s.president, target });
  events.push({ type: "investigationResult", president: s.president, target, party });
  startNextRound(ctx);
  return undefined;
}

/** Policy Peek: the President has seen the top three policies and moves on. */
export function acknowledgePeek(ctx: Ctx): void {
  startNextRound(ctx);
}

/**
 * Special Election: the President picks the next President (any other living
 * player, even a term-limited one). The rotation then resumes from the left of
 * the President who called it.
 */
export function specialElection(ctx: Ctx, target: Seat): EngineError | undefined {
  const { s, events } = ctx;
  if (!validTarget(ctx, target)) return invalidTarget();
  events.push({ type: "specialElectionCalled", president: s.president, target });
  s.president = target;
  s.phase = { kind: "nominate" };
  events.push({ type: "roundStarted", president: target, special: true });
  return undefined;
}

/** Execution: the target dies. If it was Hitler the liberals win; otherwise the party stays secret. */
export function execute(ctx: Ctx, target: Seat): EngineError | undefined {
  const { s, events } = ctx;
  if (!validTarget(ctx, target)) return invalidTarget();
  s.alive[target] = false;
  events.push({ type: "playerExecuted", president: s.president, target });
  if (s.roles[target] === "hitler") {
    endGame(ctx, "liberal", "hitlerExecuted");
    return undefined;
  }
  startNextRound(ctx);
  return undefined;
}
