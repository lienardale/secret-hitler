import { VETO_UNLOCK, powerBoard } from "../constants";
import type { Ctx } from "../context";
import { ensureDeck, sortPolicies } from "../deck";
import { engineError } from "../errors";
import { startNextRound } from "../rotation";
import type { EngineError, Phase, Policy } from "../types";
import { advanceTracker } from "./chaos";
import { placePolicy } from "./end";
import { isIndex } from "./guards";

type DiscardPhase = Extract<Phase, { kind: "presidentDiscard" }>;
type EnactPhase = Extract<Phase, { kind: "chancellorEnact" }>;
type VetoPhase = Extract<Phase, { kind: "vetoResponse" }>;

/** The President discards one of three policies and passes the other two, at once. */
export function presidentDiscard(
  ctx: Ctx,
  phase: DiscardPhase,
  index: number,
): EngineError | undefined {
  if (!isIndex(index, phase.hand.length)) {
    return engineError("INVALID_INDEX", "Pick one of your three policies.");
  }
  const { s, events } = ctx;
  const hand = phase.hand.slice();
  const discarded = hand.splice(index, 1)[0] as Policy;
  s.discard.push(discarded);
  s.phase = { kind: "chancellorEnact", chancellor: phase.chancellor, hand, vetoRefused: false };
  events.push({ type: "presidentDiscarded", president: s.president, policy: discarded });
  events.push({ type: "chancellorReceived", chancellor: phase.chancellor, policies: hand.slice() });
  return undefined;
}

/** The Chancellor enacts one of two policies and discards the other. */
export function chancellorEnact(
  ctx: Ctx,
  phase: EnactPhase,
  index: number,
): EngineError | undefined {
  if (!isIndex(index, phase.hand.length)) {
    return engineError("INVALID_INDEX", "Pick one of your two policies.");
  }
  const { s, events } = ctx;
  const hand = phase.hand.slice();
  const enacted = hand.splice(index, 1)[0] as Policy;
  const discarded = hand[0] as Policy;
  s.discard.push(discarded);
  events.push({ type: "chancellorDiscarded", chancellor: phase.chancellor, policy: discarded });
  enactByGovernment(ctx, enacted);
  return undefined;
}

/** Once 5 fascist policies are on the board, the Chancellor may propose a veto, once per session. */
export function proposeVeto(ctx: Ctx, phase: EnactPhase): EngineError | undefined {
  const { s, events } = ctx;
  if (s.fascist < VETO_UNLOCK || phase.vetoRefused) {
    return engineError("VETO_UNAVAILABLE", "The veto is not available.");
  }
  s.phase = { kind: "vetoResponse", chancellor: phase.chancellor, hand: phase.hand.slice() };
  events.push({ type: "vetoProposed", chancellor: phase.chancellor });
  return undefined;
}

/**
 * If the President agrees, both policies are discarded and the election
 * tracker advances (which can cause chaos). If not, the Chancellor must enact.
 */
export function respondVeto(ctx: Ctx, phase: VetoPhase, agree: boolean): void {
  const { s, events } = ctx;
  events.push({ type: "vetoResponded", president: s.president, agree });
  if (!agree) {
    s.phase = {
      kind: "chancellorEnact",
      chancellor: phase.chancellor,
      hand: phase.hand,
      vetoRefused: true,
    };
    return;
  }
  s.discard.push(...phase.hand);
  ensureDeck(ctx);
  advanceTracker(ctx);
}

/**
 * Enact a policy chosen by an elected government. The draw pile is topped up
 * at the end of the session, before any power, so a Policy Peek sees the
 * reshuffled pile. A fascist policy may grant the President a power.
 */
function enactByGovernment(ctx: Ctx, policy: Policy): void {
  const { s, events } = ctx;
  if (placePolicy(ctx, policy, false)) return;
  ensureDeck(ctx);

  const power = policy === "F" ? (powerBoard(s.playerCount)[s.fascist - 1] ?? null) : null;
  if (power === null) {
    startNextRound(ctx);
    return;
  }
  const peek = power === "peek" ? sortPolicies(s.deck.slice(0, 3)) : null;
  s.phase = { kind: "executive", power, peek };
  events.push({ type: "powerGranted", president: s.president, power });
  if (peek) events.push({ type: "peekRevealed", president: s.president, policies: peek.slice() });
}
