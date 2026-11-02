/**
 * Per-player projections of the game state.
 *
 * This is the only shape of the game that ever leaves the server. A view holds
 * the public table (boards, tracker, who is President, vote flags…) plus, for
 * a seated player, what that player is allowed to know: their role, the roles
 * revealed to them at night, their own investigation results, and the policies
 * in their hand. Spectators get the public part only. Every role is revealed
 * once the game is over, or when the room stopped the game without a winner
 * (`{ stopped: true }`).
 *
 * Never sent before the end: the deck order, other players' roles, the seed,
 * other players' hands or peeks, and individual votes before all are cast.
 */
import { VETO_UNLOCK, powerBoard } from "./constants";
import { isTermLimited } from "./eligibility";
import { knownRoles, partyOf } from "./knowledge";
import { legalActions } from "./legal";
import { isSeat } from "./phases/guards";
import type {
  Action,
  GameState,
  Party,
  Phase,
  PlayerCount,
  Policy,
  Power,
  Role,
  Seat,
  VoteRecord,
  WinReason,
} from "./types";

declare const projectedBrand: unique symbol;

/** A value produced by `viewFor`. The rooms layer only sends `Projected` values. */
export type Projected<T> = T & { readonly [projectedBrand]: true };

export type Viewer = Seat | "spectator";

export type PhaseView =
  | { kind: "nominate" }
  | { kind: "vote"; nominee: Seat }
  | { kind: "presidentDiscard"; chancellor: Seat }
  | { kind: "chancellorEnact"; chancellor: Seat; vetoRefused: boolean }
  | { kind: "vetoResponse"; chancellor: Seat }
  | { kind: "executive"; power: Power }
  | { kind: "over"; winner: Party; reason: WinReason };

export interface SeatView {
  seat: Seat;
  alive: boolean;
  isPresident: boolean;
  /** Nominated Chancellor during the vote. */
  isNominee: boolean;
  /** Chancellor of the government in session (legislative and veto phases). */
  isChancellor: boolean;
  /** Cannot be nominated Chancellor this round. */
  termLimited: boolean;
  confirmedNotHitler: boolean;
  investigated: boolean;
  /** During a vote: whether this seat has voted (not how). Null outside votes. */
  hasVoted: boolean | null;
}

export interface MeView {
  seat: Seat;
  role: Role;
  party: Party;
  /** Roles revealed to this player at night, their own included. */
  knownRoles: { seat: Seat; role: Role }[];
  /** Results of investigations this player made as President. */
  investigations: { target: Seat; party: Party }[];
  /** Policies in this player's hand (President: 3, Chancellor: 2), else null. */
  hand: Policy[] | null;
  /** Top three policies, for the President using Policy Peek, else null. */
  peek: Policy[] | null;
  /** What this player may do right now. */
  legal: Action[];
}

export interface PlayerView {
  seq: number;
  playerCount: PlayerCount;
  phase: PhaseView;
  president: Seat;
  seats: SeatView[];
  liberal: number;
  fascist: number;
  tracker: number;
  deckCount: number;
  discardCount: number;
  powerBoard: (Power | null)[];
  vetoUnlocked: boolean;
  lastElected: { president: Seat | null; chancellor: Seat | null };
  lastVote: VoteRecord | null;
  /** Every role, revealed only once the game is over. */
  roles: Role[] | null;
  /** Null for spectators. */
  me: MeView | null;
}

function phaseView(phase: Phase): PhaseView {
  switch (phase.kind) {
    case "nominate":
      return { kind: "nominate" };
    case "vote":
      return { kind: "vote", nominee: phase.nominee };
    case "presidentDiscard":
      return { kind: "presidentDiscard", chancellor: phase.chancellor };
    case "chancellorEnact":
      return {
        kind: "chancellorEnact",
        chancellor: phase.chancellor,
        vetoRefused: phase.vetoRefused,
      };
    case "vetoResponse":
      return { kind: "vetoResponse", chancellor: phase.chancellor };
    case "executive":
      return { kind: "executive", power: phase.power };
    case "over":
      return { kind: "over", winner: phase.winner, reason: phase.reason };
  }
}

/** The Chancellor of the government in session, if any. */
function sittingChancellor(phase: Phase): Seat | null {
  switch (phase.kind) {
    case "presidentDiscard":
    case "chancellorEnact":
    case "vetoResponse":
      return phase.chancellor;
    default:
      return null;
  }
}

function handOf(state: GameState, seat: Seat): Policy[] | null {
  const phase = state.phase;
  if (phase.kind === "presidentDiscard" && seat === state.president) return phase.hand.slice();
  if (
    (phase.kind === "chancellorEnact" || phase.kind === "vetoResponse") &&
    seat === phase.chancellor
  ) {
    return phase.hand.slice();
  }
  return null;
}

function meView(state: GameState, seat: Seat): MeView {
  const role = state.roles[seat] as Role;
  const phase = state.phase;
  return {
    seat,
    role,
    party: partyOf(role),
    knownRoles: knownRoles(state, seat),
    investigations: state.investigations
      .filter((inv) => inv.by === seat)
      .map(({ target, party }) => ({ target, party })),
    hand: handOf(state, seat),
    peek:
      phase.kind === "executive" && phase.peek !== null && seat === state.president
        ? phase.peek.slice()
        : null,
    legal: legalActions(state, seat),
  };
}

export interface ViewOptions {
  /**
   * The room stopped this game without a winner (abandoned, or ended by the
   * host): every role is revealed and nobody has an action left.
   */
  stopped?: boolean;
}

export function viewFor(
  state: GameState,
  viewer: Viewer,
  options: ViewOptions = {},
): Projected<PlayerView> {
  if (viewer !== "spectator" && !isSeat(state, viewer)) {
    throw new RangeError(`viewFor: no seat ${String(viewer)}`);
  }
  const phase = state.phase;
  const chancellor = sittingChancellor(phase);
  const over = phase.kind === "over";
  const stopped = options.stopped === true;

  const seats = state.alive.map((alive, seat): SeatView => ({
    seat,
    alive,
    isPresident: seat === state.president,
    isNominee: phase.kind === "vote" && phase.nominee === seat,
    isChancellor: chancellor === seat,
    termLimited: isTermLimited(state, seat),
    confirmedNotHitler: state.confirmedNotHitler[seat] === true,
    investigated: state.investigated[seat] === true,
    hasVoted: phase.kind === "vote" ? phase.votes[seat] !== null : null,
  }));

  const view: PlayerView = {
    seq: state.seq,
    playerCount: state.playerCount,
    phase: phaseView(phase),
    president: state.president,
    seats,
    liberal: state.liberal,
    fascist: state.fascist,
    tracker: state.tracker,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    powerBoard: [...powerBoard(state.playerCount)],
    vetoUnlocked: state.fascist >= VETO_UNLOCK,
    lastElected: { ...state.lastElected },
    lastVote: state.lastVote ? { ...state.lastVote, votes: state.lastVote.votes.slice() } : null,
    roles: over || stopped ? state.roles.slice() : null,
    me: viewer === "spectator" ? null : meView(state, viewer),
  };
  if (stopped && view.me) view.me.legal = [];
  return view as Projected<PlayerView>;
}
