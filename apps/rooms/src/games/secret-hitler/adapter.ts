/**
 * Secret Hitler behind the GameModule seam: the rules engine plus the room
 * policies that depend on the game (turn timers, who may chat when).
 */
import {
  STATE_VERSION,
  apply,
  defaultAction,
  eventsFor,
  migrate,
  outcome,
  partyOf,
  pendingActors,
  setup,
  viewFor,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerView,
  type Power,
  type Projected,
} from "@sh/engine";
import { actionSchema, type TimerPreset } from "@sh/protocol";

import type { GameModule } from "../types";

type TimerKey =
  "nominate" | "vote" | "presidentDiscard" | "chancellorEnact" | "vetoResponse" | Power;

/** Seconds per decision with the standard (public) timers. */
const STANDARD: Record<TimerKey, number> = {
  nominate: 60,
  vote: 45,
  presidentDiscard: 45,
  chancellorEnact: 45,
  vetoResponse: 30,
  investigate: 60,
  specialElection: 60,
  execute: 90,
  peek: 20,
};

const FAST: Record<TimerKey, number> = {
  nominate: 20,
  vote: 15,
  presidentDiscard: 15,
  chancellorEnact: 15,
  vetoResponse: 10,
  investigate: 20,
  specialElection: 20,
  execute: 30,
  peek: 8,
};

const PRESETS: Record<TimerPreset, ((key: TimerKey) => number) | null> = {
  off: null,
  relaxed: (key) => STANDARD[key] * 2,
  standard: (key) => STANDARD[key],
  fast: (key) => FAST[key],
};

function timerKey(state: GameState): TimerKey | null {
  const phase = state.phase;
  switch (phase.kind) {
    case "over":
      return null;
    case "executive":
      return phase.power;
    default:
      return phase.kind;
  }
}

/** The President and Chancellor stay silent while they hold policies (official rule). */
function inLegislativeSession(state: GameState, seat: number): boolean {
  const phase = state.phase;
  switch (phase.kind) {
    case "presidentDiscard":
    case "chancellorEnact":
    case "vetoResponse":
      return seat === state.president || seat === phase.chancellor;
    default:
      return false;
  }
}

export const secretHitler: GameModule<GameState, Action, Projected<PlayerView>, GameEvent> = {
  id: "secret-hitler",
  minPlayers: 5,
  maxPlayers: 10,
  stateVersion: STATE_VERSION,

  parseAction(raw) {
    const parsed = actionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },

  setup: (playerCount, seed) => setup(playerCount, seed),

  apply(state, seat, action) {
    const result = apply(state, { seat, action });
    return result.ok
      ? { ok: true, state: result.state, events: result.events }
      : { ok: false, code: result.error.code };
  },

  view: (state, viewer, options) => viewFor(state, viewer, options),
  eventsFor: (events, viewer) => eventsFor(events, viewer),
  pendingActors: (state) => pendingActors(state),
  defaultAction: (state, seat, rand) => defaultAction(state, seat, rand),

  phaseKey(state) {
    const phase = state.phase;
    const detail =
      phase.kind === "executive"
        ? phase.power
        : phase.kind === "chancellorEnact"
          ? String(phase.vetoRefused)
          : "";
    const alive = state.alive.filter(Boolean).length;
    return `${phase.kind}:${detail}:p${state.president}:L${state.liberal}F${state.fascist}:t${state.tracker}:a${alive}`;
  },

  decisionMs(state, preset) {
    const key = timerKey(state);
    const seconds = PRESETS[preset];
    return key === null || seconds === null ? null : seconds(key) * 1000;
  },

  canChat(state, seat) {
    if (state.phase.kind === "over") return true;
    if (seat === null || !state.alive[seat]) return false;
    return !inLegislativeSession(state, seat);
  },

  isAlive: (state, seat) => state.alive[seat] === true,

  result(state) {
    const end = outcome(state);
    if (end === null) return null;
    const winners = state.roles.flatMap((role, seat) =>
      partyOf(role) === end.winner ? [seat] : [],
    );
    return { result: { kind: "finished", winner: end.winner, reason: end.reason }, winners };
  },

  roleOf(state, seat) {
    const role = state.roles[seat];
    if (role === undefined) throw new RangeError(`roleOf: no seat ${seat}`);
    return role;
  },

  migrate: (raw) => migrate(raw),
};
