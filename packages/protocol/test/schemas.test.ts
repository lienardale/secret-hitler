import {
  apply,
  eventsFor,
  legalActions,
  pendingActors,
  playRandomGame,
  seededRandom,
  setup,
  viewFor,
  type Action,
  type GameEvent,
  type GameEventType,
  type GameState,
  type Seed,
} from "@sh/engine";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  actionSchema,
  clientMessageSchema,
  gameEventSchema,
  playerViewSchema,
  serverMessageSchema,
  type RoomView,
} from "../src";

const RUNS = Math.max(50, Math.floor(Number(process.env.FC_RUNS ?? 1000) / 10));
const uint32 = fc.integer({ min: 0, max: 0xffffffff });

const EVENT_TYPES: Record<GameEventType, true> = {
  gameStarted: true,
  roundStarted: true,
  chancellorNominated: true,
  voteCast: true,
  voteResult: true,
  chancellorConfirmedNotHitler: true,
  trackerAdvanced: true,
  policiesDrawn: true,
  presidentDiscarded: true,
  chancellorReceived: true,
  chancellorDiscarded: true,
  vetoProposed: true,
  vetoResponded: true,
  policyEnacted: true,
  deckReshuffled: true,
  powerGranted: true,
  peekRevealed: true,
  playerInvestigated: true,
  investigationResult: true,
  specialElectionCalled: true,
  playerExecuted: true,
  gameOver: true,
};
const EVENT_TYPE_COUNT = Object.keys(EVENT_TYPES).length;

/** Plays a random game with the engine API directly, keeping every event. */
function playCollecting(playerCount: number, seed: Seed, rand: () => number) {
  let { state, events } = setup(playerCount, seed);
  const all: GameEvent[] = [...events];
  const states: GameState[] = [state];
  while (state.phase.kind !== "over") {
    const actors = pendingActors(state);
    const seat = actors[Math.floor(rand() * actors.length)] as number;
    const legal = legalActions(state, seat);
    const action = legal[Math.floor(rand() * legal.length)] as Action;
    const result = apply(state, { seat, action });
    if (!result.ok) throw new Error(result.error.code);
    ({ state, events } = result);
    all.push(...events);
    states.push(state);
  }
  return { states, events: all };
}

function expectValid(schema: typeof playerViewSchema | typeof gameEventSchema, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${parsed.error.message}\n${JSON.stringify(value)}`);
}

describe("every engine view and event passes the strict schemas", () => {
  it("for every viewer at every step of random games", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 10 }),
        fc.tuple(uint32, uint32, uint32, uint32),
        uint32,
        (playerCount, seed, choiceSeed) => {
          const { states, events } = playCollecting(playerCount, seed, seededRandom(choiceSeed));
          for (const state of states) {
            for (let seat = 0; seat < playerCount; seat++) {
              const view = viewFor(state, seat);
              expectValid(playerViewSchema, view);
              for (const action of view.me?.legal ?? []) actionSchema.parse(action);
            }
            expectValid(playerViewSchema, viewFor(state, "spectator"));
          }
          for (const viewer of [...Array(playerCount).keys(), "spectator" as const]) {
            for (const event of eventsFor(events, viewer)) expectValid(gameEventSchema, event);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("covering every event type", () => {
    const seen = new Set<string>();
    for (let i = 0; seen.size < EVENT_TYPE_COUNT && i < 2000; i++) {
      const { events } = playCollecting(5 + (i % 6), [i, i * 7, i * 13, 99], seededRandom(i));
      for (const event of events) seen.add(event.type);
    }
    expect(seen.size).toBe(EVENT_TYPE_COUNT);
  });
});

describe("strictness", () => {
  it("refuses a view with an extra field", () => {
    const result = playRandomGame(5, [1, 2, 3, 4], seededRandom(1));
    const view = viewFor(result.state, 0);
    expect(playerViewSchema.safeParse({ ...view, deck: ["L"] }).success).toBe(false);
    expect(playerViewSchema.safeParse({ ...view, me: { ...view.me, secret: "x" } }).success).toBe(
      false,
    );
  });

  it("refuses an event with an extra field", () => {
    expect(gameEventSchema.safeParse({ type: "voteCast", seat: 1 }).success).toBe(true);
    expect(gameEventSchema.safeParse({ type: "voteCast", seat: 1, ja: true }).success).toBe(false);
    expect(eventsFor([{ type: "voteCast", seat: 1 }], "spectator")).toHaveLength(1);
  });
});

describe("client messages", () => {
  it.each([
    { t: "sit" },
    { t: "settings", timers: "fast" },
    { t: "action", turn: 3, action: { type: "vote", ja: true } },
    { t: "chat", text: "hello" },
    { t: "kick", pid: "p1" },
    { t: "sync" },
  ])("accepts %j", (message) => {
    expect(clientMessageSchema.safeParse(message).success).toBe(true);
  });

  it.each([
    { t: "nope" },
    { t: "sit", extra: 1 },
    { t: "action", turn: 0, action: { type: "vote", ja: true } },
    { t: "action", turn: 1, action: { type: "vote", ja: "yes" } },
    { t: "action", turn: 1, action: { type: "execute", target: 12 } },
    { t: "settings", minPlayers: 4 },
    { t: "chat", text: "x".repeat(2000) },
  ])("refuses %j", (message) => {
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });
});

describe("server messages", () => {
  const room: RoomView = {
    code: "BCDFG",
    visibility: "private",
    lang: "fr",
    status: "lobby",
    settings: { timers: "off", minPlayers: 7 },
    hostPid: "p1",
    players: [{ pid: "p1", name: "Ada", guest: true, connected: true, afk: false }],
    spectators: [],
    startsAt: null,
    game: null,
    result: null,
  };

  it("accepts a lobby welcome", () => {
    const welcome = {
      t: "welcome",
      protocol: 1,
      you: { pid: "p1", name: "Ada" },
      room,
      game: null,
      chat: [{ kind: "system", id: 1, at: 5, key: "playerJoined", params: { name: "Ada" } }],
      serverTime: 10,
    };
    expect(serverMessageSchema.safeParse(welcome).success).toBe(true);
  });

  it("refuses a room view that leaks an identity", () => {
    const leaky = { ...room, players: [{ ...room.players[0], sub: "user-123" }] };
    expect(serverMessageSchema.safeParse({ t: "room", room: leaky, serverTime: 1 }).success).toBe(
      false,
    );
  });
});
