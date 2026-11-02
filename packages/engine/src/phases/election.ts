import { HITLER_ZONE } from "../constants";
import type { Ctx } from "../context";
import { draw, sortPolicies } from "../deck";
import { isEligibleChancellor } from "../eligibility";
import { engineError } from "../errors";
import { aliveCount } from "../rotation";
import type { EngineError, Phase, Seat } from "../types";
import { advanceTracker } from "./chaos";
import { endGame } from "./end";
import { isSeat } from "./guards";

type VotePhase = Extract<Phase, { kind: "vote" }>;

export function nominate(ctx: Ctx, target: Seat): EngineError | undefined {
  const { s, events } = ctx;
  if (!isSeat(s, target) || !s.alive[target] || target === s.president) {
    return engineError("INVALID_TARGET", "Nominate another living player.");
  }
  if (!isEligibleChancellor(s, target)) {
    return engineError("INELIGIBLE_CHANCELLOR", "That player is term-limited.");
  }
  s.phase = { kind: "vote", nominee: target, votes: s.alive.map(() => null) };
  events.push({ type: "chancellorNominated", president: s.president, nominee: target });
  return undefined;
}

export function castVote(ctx: Ctx, phase: VotePhase, seat: Seat, ja: boolean): void {
  const { s, events } = ctx;
  phase.votes[seat] = ja;
  events.push({ type: "voteCast", seat });
  const everyoneVoted = s.alive.every((alive, i) => !alive || phase.votes[i] !== null);
  if (everyoneVoted) resolveVote(ctx, phase);
}

/** A majority of Ja among living players elects the government; a tie fails. */
function resolveVote(ctx: Ctx, phase: VotePhase): void {
  const { s, events } = ctx;
  const ja = phase.votes.filter((v) => v === true).length;
  const passed = ja * 2 > aliveCount(s);
  const votes = phase.votes.slice();
  s.lastVote = { president: s.president, nominee: phase.nominee, votes, passed };
  events.push({
    type: "voteResult",
    president: s.president,
    nominee: phase.nominee,
    votes: votes.slice(),
    passed,
  });

  if (!passed) {
    advanceTracker(ctx);
    return;
  }

  s.lastElected = { president: s.president, chancellor: phase.nominee };
  if (s.fascist >= HITLER_ZONE) {
    if (s.roles[phase.nominee] === "hitler") {
      endGame(ctx, "fascist", "hitlerElected");
      return;
    }
    s.confirmedNotHitler[phase.nominee] = true;
    events.push({ type: "chancellorConfirmedNotHitler", seat: phase.nominee });
  }

  const hand = sortPolicies(draw(ctx, 3));
  s.phase = { kind: "presidentDiscard", chancellor: phase.nominee, hand };
  events.push({ type: "policiesDrawn", president: s.president, policies: hand.slice() });
}
