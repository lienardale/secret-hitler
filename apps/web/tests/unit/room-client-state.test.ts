import { describe, expect, it } from "vitest";
import type { ChatMessage, RoomView, ServerMessage } from "@sh/protocol";
import { playRandomGame, seededRandom, viewFor } from "@sh/engine";

import { initialRoomState, reduce, type RoomClientState } from "../../lib/room-client/state";

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

const chat = (id: number): ChatMessage => ({
  kind: "system",
  id,
  at: id,
  key: "playerJoined",
  params: { name: "Ada" },
});

function receive(
  state: RoomClientState,
  message: ServerMessage,
  receivedAt = 1000,
): RoomClientState {
  return reduce(state, { type: "message", message, receivedAt });
}

const welcome: ServerMessage = {
  t: "welcome",
  protocol: 1,
  you: { pid: "p1", name: "Ada" },
  room,
  game: null,
  chat: [chat(1), chat(2)],
  serverTime: 5000,
};

describe("room client state", () => {
  it("is open and complete after a welcome, with the clock offset", () => {
    const state = receive(initialRoomState, welcome, 1000);
    expect(state).toMatchObject({ status: "open", you: { pid: "p1" }, room, clockOffset: 4000 });
    expect(state.chat).toHaveLength(2);
  });

  it("appends game events and replaces the view", () => {
    const { state: game } = playRandomGame(5, [1, 2, 3, 4], seededRandom(1), { maxActions: 3 });
    const view = viewFor(game, 0);
    let state = receive(initialRoomState, { ...welcome, game: { turn: 1, view, log: [] } });
    state = reduce(state, { type: "actionSent" });
    expect(state.actionPending).toBe(true);
    state = receive(state, { t: "game", turn: 2, view, events: [{ type: "voteCast", seat: 1 }] });
    state = receive(state, { t: "game", turn: 2, view, events: [{ type: "voteCast", seat: 2 }] });
    expect(state.game?.log).toHaveLength(2);
    expect(state.game?.turn).toBe(2);
    expect(state.actionPending).toBe(false);
  });

  it("drops the game when the room goes back to the lobby (rematch)", () => {
    const { state: game } = playRandomGame(5, [1, 2, 3, 4], seededRandom(1), { maxActions: 3 });
    let state = receive(initialRoomState, {
      ...welcome,
      game: { turn: 1, view: viewFor(game, 0), log: [] },
    });
    state = receive(state, { t: "room", room: { ...room, status: "ended" }, serverTime: 6000 });
    expect(state.game).not.toBeNull();
    state = receive(state, { t: "room", room, serverTime: 7000 });
    expect(state.game).toBeNull();
  });

  it("skips chat messages it already has", () => {
    let state = receive(initialRoomState, welcome);
    state = receive(state, { t: "chat", message: chat(2) });
    state = receive(state, { t: "chat", message: chat(3) });
    expect(state.chat.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("records refusals and releases the pending action", () => {
    let state = reduce(receive(initialRoomState, welcome), { type: "actionSent" });
    state = receive(state, { t: "error", code: "stale_turn" }, 42);
    expect(state.lastError).toEqual({ code: "stale_turn", at: 42 });
    expect(state.actionPending).toBe(false);
  });

  it("tracks the connection: lost, back, closed for good", () => {
    let state = receive(initialRoomState, welcome);
    state = reduce(state, { type: "lost" });
    expect(state.status).toBe("reconnecting");
    state = receive(state, welcome);
    expect(state.status).toBe("open");
    state = reduce(state, { type: "closed", code: 4423 });
    expect(state).toMatchObject({ status: "closed", closeCode: 4423 });
    expect(reduce(state, { type: "lost" }).status).toBe("closed");
  });

  it("asks for a name when the ticket route has no guest", () => {
    expect(reduce(initialRoomState, { type: "needsName" })).toMatchObject({
      needsName: true,
      status: "closed",
    });
  });
});
