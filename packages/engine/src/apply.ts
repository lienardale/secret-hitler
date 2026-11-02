import type { Ctx } from "./context";
import { engineError } from "./errors";
import type { GameEvent } from "./events";
import { castVote, nominate } from "./phases/election";
import { acknowledgePeek, execute, investigate, specialElection } from "./phases/executive";
import { isSeat } from "./phases/guards";
import { chancellorEnact, presidentDiscard, proposeVeto, respondVeto } from "./phases/legislative";
import type { Action, EngineError, GameState, Move, Seat } from "./types";

export type ApplyResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: EngineError };

/**
 * Apply one player's action. Pure: the input state is never modified; a valid
 * action returns a new state and the events it produced, an invalid one
 * returns an error and changes nothing.
 */
export function apply(state: GameState, move: Move): ApplyResult {
  const { seat, action } = move;
  if (state.phase.kind === "over") {
    return { ok: false, error: engineError("GAME_OVER", "The game is over.") };
  }
  if (!isSeat(state, seat)) {
    return { ok: false, error: engineError("INVALID_SEAT", "No such seat.") };
  }
  if (!state.alive[seat]) {
    return { ok: false, error: engineError("DEAD_PLAYER", "Executed players cannot act.") };
  }

  const ctx: Ctx = { s: structuredClone(state), events: [] };
  const error = dispatch(ctx, seat, action);
  if (error) return { ok: false, error };
  ctx.s.seq += 1;
  return { ok: true, state: ctx.s, events: ctx.events };
}

const wrongPhase = (): EngineError =>
  engineError("WRONG_PHASE", "That action is not possible now.");
const notYourTurn = (): EngineError => engineError("NOT_YOUR_TURN", "It is not your turn.");
const invalidAction = (): EngineError => engineError("INVALID_ACTION", "Malformed action.");

function dispatch(ctx: Ctx, seat: Seat, action: Action): EngineError | undefined {
  const { s } = ctx;
  const phase = s.phase;

  switch (action.type) {
    case "nominate":
      if (phase.kind !== "nominate") return wrongPhase();
      if (seat !== s.president) return notYourTurn();
      return nominate(ctx, action.target);

    case "vote":
      if (phase.kind !== "vote") return wrongPhase();
      if (typeof action.ja !== "boolean") return invalidAction();
      if (phase.votes[seat] !== null) {
        return engineError("ALREADY_VOTED", "You have already voted.");
      }
      castVote(ctx, phase, seat, action.ja);
      return undefined;

    case "presidentDiscard":
      if (phase.kind !== "presidentDiscard") return wrongPhase();
      if (seat !== s.president) return notYourTurn();
      return presidentDiscard(ctx, phase, action.index);

    case "chancellorEnact":
      if (phase.kind !== "chancellorEnact") return wrongPhase();
      if (seat !== phase.chancellor) return notYourTurn();
      return chancellorEnact(ctx, phase, action.index);

    case "proposeVeto":
      if (phase.kind !== "chancellorEnact") return wrongPhase();
      if (seat !== phase.chancellor) return notYourTurn();
      return proposeVeto(ctx, phase);

    case "respondVeto":
      if (phase.kind !== "vetoResponse") return wrongPhase();
      if (seat !== s.president) return notYourTurn();
      if (typeof action.agree !== "boolean") return invalidAction();
      respondVeto(ctx, phase, action.agree);
      return undefined;

    case "investigate":
      if (phase.kind !== "executive" || phase.power !== "investigate") return wrongPhase();
      if (seat !== s.president) return notYourTurn();
      return investigate(ctx, action.target);

    case "acknowledgePeek":
      if (phase.kind !== "executive" || phase.power !== "peek") return wrongPhase();
      if (seat !== s.president) return notYourTurn();
      acknowledgePeek(ctx);
      return undefined;

    case "specialElection":
      if (phase.kind !== "executive" || phase.power !== "specialElection") return wrongPhase();
      if (seat !== s.president) return notYourTurn();
      return specialElection(ctx, action.target);

    case "execute":
      if (phase.kind !== "executive" || phase.power !== "execute") return wrongPhase();
      if (seat !== s.president) return notYourTurn();
      return execute(ctx, action.target);

    default:
      // Unknown action types can only come from malformed input at runtime.
      return invalidAction();
  }
}
