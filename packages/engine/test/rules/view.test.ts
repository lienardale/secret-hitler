import { describe, expect, it } from "vitest";

import { eventVisibility, eventsFor, type GameEvent } from "../../src/events";
import type { GameState } from "../../src/types";
import { viewFor } from "../../src/view";
import { act, elect, makeState } from "../helpers/builders";

describe("viewFor", () => {
  it("gives spectators the public table only", () => {
    const view = viewFor(makeState(), "spectator");
    expect(view.me).toBeNull();
    expect(view.roles).toBeNull();
    expect(view).toMatchObject({
      playerCount: 7,
      liberal: 0,
      fascist: 0,
      tracker: 0,
      deckCount: 17,
      discardCount: 0,
    });
    expect(view.powerBoard).toEqual([null, "investigate", "specialElection", "execute", "execute"]);
  });

  it("gives a player their role and what they learned at night", () => {
    const me = viewFor(makeState(), 1).me;
    expect(me).toMatchObject({ seat: 1, role: "fascist", party: "fascist" });
    expect(me?.knownRoles.map((k) => k.seat)).toEqual([0, 1, 2]);
    expect(viewFor(makeState(), 5).me?.knownRoles).toEqual([{ seat: 5, role: "liberal" }]);
  });

  it("shows a hand only to the player holding it", () => {
    let state = elect(makeState({ president: 1 }), 4).state;
    expect(viewFor(state, 1).me?.hand).toHaveLength(3);
    expect(viewFor(state, 4).me?.hand).toBeNull();
    expect(viewFor(state, 1).seats[4]?.isChancellor).toBe(true);
    state = act(state, 1, { type: "presidentDiscard", index: 0 }).state;
    expect(viewFor(state, 1).me?.hand).toBeNull();
    expect(viewFor(state, 4).me?.hand).toHaveLength(2);
    const veto: GameState = {
      ...state,
      fascist: 5,
      phase: { kind: "vetoResponse", chancellor: 4, hand: ["F", "F"] },
    };
    expect(viewFor(veto, 4).me?.hand).toEqual(["F", "F"]);
    expect(viewFor(veto, 1).me?.hand).toBeNull();
    expect(viewFor(veto, 1).phase).toEqual({ kind: "vetoResponse", chancellor: 4 });
    expect(viewFor(veto, 1).vetoUnlocked).toBe(true);
  });

  it("describes every phase without secret fields", () => {
    const phases: GameState["phase"][] = [
      { kind: "nominate" },
      { kind: "vote", nominee: 3, votes: [true, null, null, null, null, null, null] },
      { kind: "presidentDiscard", chancellor: 3, hand: ["L", "F", "F"] },
      { kind: "chancellorEnact", chancellor: 3, hand: ["F", "F"], vetoRefused: true },
      { kind: "vetoResponse", chancellor: 3, hand: ["F", "F"] },
      { kind: "executive", power: "peek", peek: ["L", "L", "F"] },
      { kind: "over", winner: "fascist", reason: "hitlerElected" },
    ];
    const expected = [
      { kind: "nominate" },
      { kind: "vote", nominee: 3 },
      { kind: "presidentDiscard", chancellor: 3 },
      { kind: "chancellorEnact", chancellor: 3, vetoRefused: true },
      { kind: "vetoResponse", chancellor: 3 },
      { kind: "executive", power: "peek" },
      { kind: "over", winner: "fascist", reason: "hitlerElected" },
    ];
    phases.forEach((phase, i) => {
      const view = viewFor({ ...makeState({ president: 1 }), phase }, "spectator");
      expect(view.phase).toEqual(expected[i]);
      expect(JSON.stringify(view)).not.toMatch(/"(hand|peek|votes|deck|rng|investigations)":/);
    });
  });

  it("reveals every role once the game is over", () => {
    const state: GameState = {
      ...makeState(),
      phase: { kind: "over", winner: "liberal", reason: "hitlerExecuted" },
    };
    expect(viewFor(state, "spectator").roles).toEqual(state.roles);
    expect(viewFor(state, 3).me?.legal).toEqual([]);
  });

  it("refuses an unknown viewer seat", () => {
    expect(() => viewFor(makeState(), 7)).toThrow(RangeError);
  });

  it("returns copies, not references into the state", () => {
    const state = elect(makeState({ president: 1 }), 4).state;
    const view = viewFor(state, 1);
    view.me?.hand?.push("L");
    view.lastVote?.votes.push(true);
    expect(state.phase).toMatchObject({ hand: ["L", "L", "L"] });
    expect(state.lastVote?.votes).toHaveLength(7);
  });
});

describe("event visibility", () => {
  const privateEvents: GameEvent[] = [
    { type: "policiesDrawn", president: 1, policies: ["L", "F", "F"] },
    { type: "presidentDiscarded", president: 1, policy: "L" },
    { type: "peekRevealed", president: 1, policies: ["F", "F", "F"] },
    { type: "investigationResult", president: 1, target: 0, party: "fascist" },
    { type: "chancellorReceived", chancellor: 4, policies: ["F", "F"] },
    { type: "chancellorDiscarded", chancellor: 4, policy: "F" },
  ];

  it("private events reach only their owner", () => {
    expect(eventVisibility(privateEvents[0] as GameEvent)).toEqual([1]);
    expect(eventVisibility(privateEvents[4] as GameEvent)).toEqual([4]);
    expect(eventsFor(privateEvents, "spectator")).toEqual([]);
    expect(eventsFor(privateEvents, 2)).toEqual([]);
    expect(eventsFor(privateEvents, 1)).toHaveLength(4);
    expect(eventsFor(privateEvents, 4)).toHaveLength(2);
  });

  it("public events reach everyone", () => {
    const events: GameEvent[] = [{ type: "voteCast", seat: 3 }];
    expect(eventsFor(events, "spectator")).toEqual(events);
    expect(eventVisibility(events[0] as GameEvent)).toBe("public");
  });
});
