/**
 * Core types of the Secret Hitler rules engine.
 *
 * `GameState` is the complete, secret state of one game. It only ever lives on
 * the server (the room's Durable Object). Clients receive `PlayerView`s built
 * by `viewFor()` instead (see view.ts).
 */

export type Policy = "L" | "F";
export type Party = "liberal" | "fascist";
export type Role = "liberal" | "fascist" | "hitler";

/** Seat index, 0..playerCount-1. Clockwise order is increasing index. */
export type Seat = number;

export type PlayerCount = 5 | 6 | 7 | 8 | 9 | 10;

export type Power = "investigate" | "peek" | "specialElection" | "execute";

export type WinReason = "liberalPolicies" | "hitlerExecuted" | "fascistPolicies" | "hitlerElected";

/** xoshiro128** state: four unsigned 32-bit integers. */
export type RngState = readonly [number, number, number, number];

/** 128-bit seed supplied by the server (crypto-random), never shown to players. */
export type Seed = readonly [number, number, number, number];

export type Phase =
  /** The President picks a Chancellor candidate. */
  | { kind: "nominate" }
  /** Every living player votes Ja or Nein. `votes[seat]` is null until cast (and for dead seats). */
  | { kind: "vote"; nominee: Seat; votes: (boolean | null)[] }
  /** The President holds 3 policies and discards one. */
  | { kind: "presidentDiscard"; chancellor: Seat; hand: Policy[] }
  /** The Chancellor holds 2 policies and enacts one (or proposes a veto once unlocked). */
  | { kind: "chancellorEnact"; chancellor: Seat; hand: Policy[]; vetoRefused: boolean }
  /** The Chancellor proposed a veto; the President agrees or refuses. */
  | { kind: "vetoResponse"; chancellor: Seat; hand: Policy[] }
  /** The President must use a power. `peek` holds the top 3 policies for the Policy Peek power. */
  | { kind: "executive"; power: Power; peek: Policy[] | null }
  | { kind: "over"; winner: Party; reason: WinReason };

export type PhaseKind = Phase["kind"];

export interface Investigation {
  by: Seat;
  target: Seat;
  party: Party;
}

export interface VoteRecord {
  president: Seat;
  nominee: Seat;
  /** Ballot per seat; null for dead seats. */
  votes: (boolean | null)[];
  passed: boolean;
}

export interface GameState {
  /** State schema version (see migrate.ts). */
  v: 1;
  playerCount: PlayerCount;
  /** Incremented by every successful action. Clients send it back to reject stale actions. */
  seq: number;
  roles: Role[];
  alive: boolean[];
  /** Seats already investigated (nobody can be investigated twice). */
  investigated: boolean[];
  /** Seats elected Chancellor after 3+ fascist policies, hence publicly known not to be Hitler. */
  confirmedNotHitler: boolean[];
  /** Draw pile, index 0 is the top. */
  deck: Policy[];
  discard: Policy[];
  liberal: number;
  fascist: number;
  /** Election tracker: failed elections (and agreed vetoes) since the last enacted policy. */
  tracker: number;
  president: Seat;
  /** Seat the regular rotation continues from (differs from `president` after a Special Election). */
  rotationSeat: Seat;
  /** The last *elected* government, used for term limits. Cleared by chaos. */
  lastElected: { president: Seat | null; chancellor: Seat | null };
  phase: Phase;
  investigations: Investigation[];
  lastVote: VoteRecord | null;
  rng: RngState;
}

export type Action =
  | { type: "nominate"; target: Seat }
  | { type: "vote"; ja: boolean }
  | { type: "presidentDiscard"; index: number }
  | { type: "chancellorEnact"; index: number }
  | { type: "proposeVeto" }
  | { type: "respondVeto"; agree: boolean }
  | { type: "investigate"; target: Seat }
  | { type: "acknowledgePeek" }
  | { type: "specialElection"; target: Seat }
  | { type: "execute"; target: Seat };

export type ActionType = Action["type"];

export interface Move {
  seat: Seat;
  action: Action;
}

export type EngineErrorCode =
  | "GAME_OVER"
  | "INVALID_SEAT"
  | "DEAD_PLAYER"
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "ALREADY_VOTED"
  | "INVALID_TARGET"
  | "INELIGIBLE_CHANCELLOR"
  | "ALREADY_INVESTIGATED"
  | "INVALID_INDEX"
  | "VETO_UNAVAILABLE"
  | "INVALID_ACTION";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}
