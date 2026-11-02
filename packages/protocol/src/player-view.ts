/**
 * Strict schemas for the Secret Hitler data that crosses the wire: player
 * views, game events and actions. They mirror the engine types exactly (the
 * type tests in test/player-view.test.ts fail if they drift), and the rooms
 * Worker validates every outgoing message against them in development and
 * tests, so an extra field (a leaked secret) is caught before it ships.
 */
import type { Action, GameEvent, PlayerView } from "@sh/engine";
import { z } from "zod";

const seat = z.int().min(0).max(9);
const policy = z.enum(["L", "F"]);
const party = z.enum(["liberal", "fascist"]);
const role = z.enum(["liberal", "fascist", "hitler"]);
const power = z.enum(["investigate", "peek", "specialElection", "execute"]);
const winReason = z.enum(["liberalPolicies", "hitlerExecuted", "fascistPolicies", "hitlerElected"]);
const playerCount = z.union([
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
  z.literal(10),
]);
const ballots = z.array(z.boolean().nullable()).max(10);

const actionObject = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("nominate"), target: seat }),
  z.strictObject({ type: z.literal("vote"), ja: z.boolean() }),
  z.strictObject({ type: z.literal("presidentDiscard"), index: z.int().min(0).max(2) }),
  z.strictObject({ type: z.literal("chancellorEnact"), index: z.int().min(0).max(1) }),
  z.strictObject({ type: z.literal("proposeVeto") }),
  z.strictObject({ type: z.literal("respondVeto"), agree: z.boolean() }),
  z.strictObject({ type: z.literal("investigate"), target: seat }),
  z.strictObject({ type: z.literal("acknowledgePeek") }),
  z.strictObject({ type: z.literal("specialElection"), target: seat }),
  z.strictObject({ type: z.literal("execute"), target: seat }),
]);

const voteRecord = z.strictObject({
  president: seat,
  nominee: seat,
  votes: ballots,
  passed: z.boolean(),
});

const phaseView = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("nominate") }),
  z.strictObject({ kind: z.literal("vote"), nominee: seat }),
  z.strictObject({ kind: z.literal("presidentDiscard"), chancellor: seat }),
  z.strictObject({
    kind: z.literal("chancellorEnact"),
    chancellor: seat,
    vetoRefused: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("vetoResponse"), chancellor: seat }),
  z.strictObject({ kind: z.literal("executive"), power }),
  z.strictObject({ kind: z.literal("over"), winner: party, reason: winReason }),
]);

const seatView = z.strictObject({
  seat,
  alive: z.boolean(),
  isPresident: z.boolean(),
  isNominee: z.boolean(),
  isChancellor: z.boolean(),
  termLimited: z.boolean(),
  confirmedNotHitler: z.boolean(),
  investigated: z.boolean(),
  hasVoted: z.boolean().nullable(),
});

const meView = z.strictObject({
  seat,
  role,
  party,
  knownRoles: z.array(z.strictObject({ seat, role })).max(10),
  investigations: z.array(z.strictObject({ target: seat, party })).max(10),
  hand: z.array(policy).min(2).max(3).nullable(),
  peek: z.array(policy).length(3).nullable(),
  legal: z.array(actionObject).max(10),
});

const playerViewObject = z.strictObject({
  seq: z.int().nonnegative(),
  playerCount,
  phase: phaseView,
  president: seat,
  seats: z.array(seatView).min(5).max(10),
  liberal: z.int().min(0).max(5),
  fascist: z.int().min(0).max(6),
  tracker: z.int().min(0).max(3),
  deckCount: z.int().min(0).max(17),
  discardCount: z.int().min(0).max(17),
  powerBoard: z.array(power.nullable()).length(5),
  vetoUnlocked: z.boolean(),
  lastElected: z.strictObject({ president: seat.nullable(), chancellor: seat.nullable() }),
  lastVote: voteRecord.nullable(),
  roles: z.array(role).min(5).max(10).nullable(),
  me: meView.nullable(),
});

const gameEventObject = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("gameStarted"), playerCount: z.int(), president: seat }),
  z.strictObject({ type: z.literal("roundStarted"), president: seat, special: z.boolean() }),
  z.strictObject({ type: z.literal("chancellorNominated"), president: seat, nominee: seat }),
  z.strictObject({ type: z.literal("voteCast"), seat }),
  z.strictObject({
    type: z.literal("voteResult"),
    president: seat,
    nominee: seat,
    votes: ballots,
    passed: z.boolean(),
  }),
  z.strictObject({ type: z.literal("chancellorConfirmedNotHitler"), seat }),
  z.strictObject({ type: z.literal("trackerAdvanced"), tracker: z.int().min(0).max(3) }),
  z.strictObject({
    type: z.literal("policiesDrawn"),
    president: seat,
    policies: z.array(policy).length(3),
  }),
  z.strictObject({ type: z.literal("presidentDiscarded"), president: seat, policy }),
  z.strictObject({
    type: z.literal("chancellorReceived"),
    chancellor: seat,
    policies: z.array(policy).length(2),
  }),
  z.strictObject({ type: z.literal("chancellorDiscarded"), chancellor: seat, policy }),
  z.strictObject({ type: z.literal("vetoProposed"), chancellor: seat }),
  z.strictObject({ type: z.literal("vetoResponded"), president: seat, agree: z.boolean() }),
  z.strictObject({ type: z.literal("policyEnacted"), policy, byChaos: z.boolean() }),
  z.strictObject({ type: z.literal("deckReshuffled"), deckCount: z.int().min(0).max(17) }),
  z.strictObject({ type: z.literal("powerGranted"), president: seat, power }),
  z.strictObject({
    type: z.literal("peekRevealed"),
    president: seat,
    policies: z.array(policy).length(3),
  }),
  z.strictObject({ type: z.literal("playerInvestigated"), president: seat, target: seat }),
  z.strictObject({
    type: z.literal("investigationResult"),
    president: seat,
    target: seat,
    party,
  }),
  z.strictObject({ type: z.literal("specialElectionCalled"), president: seat, target: seat }),
  z.strictObject({ type: z.literal("playerExecuted"), president: seat, target: seat }),
  z.strictObject({
    type: z.literal("gameOver"),
    winner: party,
    reason: winReason,
    roles: z.array(role).min(5).max(10),
  }),
]);

/** True when A and B are assignable both ways (no field missing or extra on either side). */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Compile-time guard: these lines stop compiling if a schema drifts from the engine types.
const schemasMatchEngine: [
  Exact<z.infer<typeof actionObject>, Action>,
  Exact<z.infer<typeof playerViewObject>, PlayerView>,
  Exact<z.infer<typeof gameEventObject>, GameEvent>,
] = [true, true, true];
void schemasMatchEngine;

export const actionSchema: z.ZodType<Action> = actionObject;
export const playerViewSchema: z.ZodType<PlayerView> = playerViewObject;
export const gameEventSchema: z.ZodType<GameEvent> = gameEventObject;
