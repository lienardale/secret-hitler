/**
 * Named game situations for the /dev/table sandbox and the component tests.
 *
 * Each fixture is reached by playing seeded random games and stopping at the
 * first state that matches, so it is a real engine state (never hand-written)
 * and the same seed always gives the same state.
 */
import {
  aliveCount,
  isPlayerCount,
  pendingActors,
  seededRandom,
  type GameEvent,
  type GameState,
  type PlayerCount,
  type Seat,
} from "@sh/engine";

import { newGame, playUntil, type LocalGame } from "./play";

export const FIXTURE_NAMES = [
  "start",
  "nominate",
  "vote",
  "voteHitlerZone",
  "voteChaos",
  "voteResult",
  "presidentDiscard",
  "chancellorEnact",
  "veto",
  "vetoResponse",
  "vetoRefused",
  "investigate",
  "investigationResult",
  "peek",
  "specialElection",
  "execute",
  "dead",
  "chaos",
  "liberalWin",
  "hitlerExecuted",
  "fascistWin",
  "hitlerElected",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function isFixtureName(value: unknown): value is FixtureName {
  return typeof value === "string" && (FIXTURE_NAMES as readonly string[]).includes(value);
}

export interface Fixture {
  name: FixtureName;
  playerCount: PlayerCount;
  /** The game seed actually used (the requested seed, or the next one that reached the state). */
  seed: number;
  /** Full secret state and every event (unfiltered): filter with `viewFor` / `eventsFor`. */
  game: LocalGame;
  /** The most interesting seat to view this fixture as (the actor), or null. */
  focusSeat: Seat | null;
  /** The sandbox shows a running timer for this fixture. */
  timed: boolean;
  /** Seats shown as disconnected / played automatically. */
  offline: Seat[];
  afk: Seat[];
}

interface FixtureSpec {
  description: string;
  /** Player counts where the situation exists (power boards differ). */
  players?: readonly PlayerCount[];
  timed?: boolean;
  /** Checked after every random move. */
  stop: (state: GameState, lastEvents: readonly GameEvent[]) => boolean;
  focus?: (state: GameState) => Seat | null;
}

const enacted = (s: GameState) => s.liberal + s.fascist;
const votesCast = (s: GameState) =>
  s.phase.kind === "vote" ? s.phase.votes.filter((v) => v !== null).length : 0;
const firstActor = (s: GameState): Seat | null => pendingActors(s)[0] ?? null;

export const FIXTURES: Readonly<Record<FixtureName, FixtureSpec>> = {
  start: {
    description: "First nomination of the game",
    timed: true,
    stop: () => true,
  },
  nominate: {
    description: "President picks a Chancellor (policies on the board, term limits)",
    timed: true,
    stop: (s) =>
      s.phase.kind === "nominate" &&
      enacted(s) >= 2 &&
      s.lastVote !== null &&
      s.lastElected.chancellor !== null,
  },
  vote: {
    description: "Voting, about half the ballots cast",
    timed: true,
    stop: (s) =>
      s.phase.kind === "vote" &&
      s.lastElected.chancellor !== null &&
      votesCast(s) === Math.floor(aliveCount(s) / 2),
  },
  voteHitlerZone: {
    description: "Voting with 3+ fascist policies down (Hitler elected would win)",
    timed: true,
    stop: (s) => s.phase.kind === "vote" && s.fascist >= 3 && votesCast(s) >= 1,
  },
  voteChaos: {
    description: "Voting with the election tracker at 2 (a failed vote means chaos)",
    timed: true,
    stop: (s) => s.phase.kind === "vote" && s.tracker === 2 && votesCast(s) >= 1,
  },
  voteResult: {
    description: "Right after a vote result (ballots on the seats, result strip)",
    stop: (s, events) =>
      enacted(s) >= 1 &&
      s.phase.kind !== "over" &&
      events.some((e) => e.type === "voteResult" && !e.passed) &&
      !events.some((e) => e.type === "policyEnacted"),
  },
  presidentDiscard: {
    description: "President discards 1 of 3",
    timed: true,
    stop: (s) => s.phase.kind === "presidentDiscard" && enacted(s) >= 1,
  },
  chancellorEnact: {
    description: "Chancellor enacts 1 of 2 (no veto yet)",
    timed: true,
    stop: (s) => s.phase.kind === "chancellorEnact" && s.fascist < 5,
  },
  veto: {
    description: "Chancellor may propose a veto",
    stop: (s) => s.phase.kind === "chancellorEnact" && s.fascist >= 5 && !s.phase.vetoRefused,
  },
  vetoResponse: {
    description: "President answers a veto proposal",
    stop: (s) => s.phase.kind === "vetoResponse",
  },
  vetoRefused: {
    description: "Veto refused: the Chancellor must enact",
    stop: (s) => s.phase.kind === "chancellorEnact" && s.phase.vetoRefused,
  },
  investigate: {
    description: "Power: investigate loyalty",
    players: [7, 8, 9, 10],
    timed: true,
    stop: (s) => s.phase.kind === "executive" && s.phase.power === "investigate",
  },
  investigationResult: {
    description: "After an investigation (view as the investigator)",
    players: [7, 8, 9, 10],
    stop: (s) => s.phase.kind === "nominate" && s.investigations.length > 0,
    focus: (s) => s.investigations[0]?.by ?? null,
  },
  peek: {
    description: "Power: policy peek",
    players: [5, 6],
    stop: (s) => s.phase.kind === "executive" && s.phase.power === "peek",
  },
  specialElection: {
    description: "Power: special election",
    players: [7, 8, 9, 10],
    stop: (s) => s.phase.kind === "executive" && s.phase.power === "specialElection",
  },
  execute: {
    description: "Power: execution",
    timed: true,
    stop: (s) => s.phase.kind === "executive" && s.phase.power === "execute",
  },
  dead: {
    description: "A player has been executed",
    stop: (s) => s.phase.kind === "nominate" && s.alive.some((alive) => !alive),
    focus: (s) => s.alive.findIndex((alive) => !alive),
  },
  chaos: {
    description: "Chaos just happened (3 failed elections)",
    stop: (s, events) =>
      s.phase.kind === "nominate" && events.some((e) => e.type === "policyEnacted" && e.byChaos),
  },
  liberalWin: {
    description: "Liberals win",
    stop: (s) => s.phase.kind === "over" && s.phase.winner === "liberal",
    focus: () => null,
  },
  hitlerExecuted: {
    description: "Liberals win: Hitler executed",
    stop: (s) => s.phase.kind === "over" && s.phase.reason === "hitlerExecuted",
    focus: () => null,
  },
  fascistWin: {
    description: "Fascists win",
    stop: (s) => s.phase.kind === "over" && s.phase.winner === "fascist",
    focus: () => null,
  },
  hitlerElected: {
    description: "Fascists win: Hitler elected Chancellor",
    stop: (s) => s.phase.kind === "over" && s.phase.reason === "hitlerElected",
    focus: () => null,
  },
};

export function fixtureDescription(name: FixtureName): string {
  return FIXTURES[name].description;
}

/** The player count actually used for a fixture (some powers only exist on some boards). */
export function fixturePlayerCount(name: FixtureName, requested: number): PlayerCount {
  const wanted: PlayerCount = isPlayerCount(requested) ? requested : 7;
  const allowed = FIXTURES[name].players;
  if (!allowed || allowed.includes(wanted)) return wanted;
  return allowed[0] as PlayerCount;
}

const MAX_ATTEMPTS = 500;

/**
 * Build a fixture. Tries game seeds `seed`, `seed + 1`, … until a random game
 * reaches the situation (the search is deterministic, so a seed always gives
 * the same fixture). Throws if nothing matched after many attempts.
 */
export function buildFixture(
  name: FixtureName,
  options: { players?: number; seed?: number } = {},
): Fixture {
  const spec = FIXTURES[name];
  const playerCount = fixturePlayerCount(name, options.players ?? 7);
  const base = Number.isFinite(options.seed) ? Math.trunc(options.seed as number) : 1;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = base + attempt;
    const start = newGame(playerCount, seed);
    const rand = seededRandom(seed ^ 0x5bd1e995);
    const found = spec.stop(start.state, start.events)
      ? { game: start, reached: true }
      : playUntil(start, rand, spec.stop);
    if (!found.reached) continue;

    const { state } = found.game;
    const focusSeat = spec.focus ? spec.focus(state) : firstActor(state);
    const { offline, afk } = absentees(name, state, focusSeat);
    return {
      name,
      playerCount,
      seed,
      game: found.game,
      focusSeat: focusSeat !== null && focusSeat >= 0 ? focusSeat : null,
      timed: spec.timed === true,
      offline,
      afk,
    };
  }
  throw new Error(`fixture ${name}: not reached in ${MAX_ATTEMPTS} games from seed ${base}`);
}

/** The vote fixture shows a disconnected and an automatically played seat among the waiting ones. */
function absentees(
  name: FixtureName,
  state: GameState,
  focusSeat: Seat | null,
): { offline: Seat[]; afk: Seat[] } {
  if (name !== "vote") return { offline: [], afk: [] };
  const waiting = pendingActors(state).filter((seat) => seat !== focusSeat);
  return {
    offline: waiting.slice(0, 1),
    afk: waiting.slice(1, 2),
  };
}
