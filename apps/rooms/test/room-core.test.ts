import { legalActions, pendingActors, replay, type Action } from "@sh/engine";
import {
  CLOSE,
  MAX_SPECTATORS,
  gameResultPayloadSchema,
  roomViewSchema,
  serverMessageSchema,
} from "@sh/protocol";
import { describe, expect, it } from "vitest";

import { secretHitler } from "../src/games/secret-hitler/adapter";
import { ROOM_TIMING, RoomCore } from "../src/room/room-core";
import {
  T0,
  act,
  guest,
  joinAll,
  makeRoom,
  pidAt,
  playToEnd,
  startedRoom,
  state,
  testDeps,
  turn,
  user,
  type Core,
} from "./helpers/core";

const SECOND = 1000;

/** Nominates the first eligible chancellor and has everyone vote Ja. */
function electGovernment(core: Core, now = T0): void {
  const s = state(core);
  const nominate = legalActions(s, s.president)[0] as Action;
  expect(act(core, s.president, nominate, now)).toBeNull();
  for (const seat of pendingActors(state(core))) {
    expect(act(core, seat, { type: "vote", ja: true }, now)).toBeNull();
  }
}

describe("joining and seats", () => {
  it("seats members as they join and makes the creator host", () => {
    const { core } = makeRoom();
    const [first] = joinAll(core, 1);
    expect(core.roomView()).toMatchObject({ hostPid: first, status: "lobby" });
    expect(core.roomView().players.map((p) => p.pid)).toEqual([first]);
  });

  it("gives the host role to the creator even if a friend connects first", () => {
    const { core } = makeRoom({ host: guest(9) });
    const friend = core.join(guest(1), T0);
    const creator = core.join(guest(9), T0 + 5 * SECOND);
    expect(friend.ok && creator.ok).toBe(true);
    if (creator.ok) expect(core.roomView().hostPid).toBe(creator.pid);
  });

  it("hands the host role to a connected member when the creator never comes", () => {
    const { core } = makeRoom({ host: guest(9) });
    const [friend] = joinAll(core, 1);
    core.tick(T0 + ROOM_TIMING.hostGraceMs - 1);
    expect(core.roomView().hostPid).toBeNull();
    core.tick(T0 + ROOM_TIMING.hostGraceMs);
    expect(core.roomView().hostPid).toBe(friend);
  });

  it("puts the 11th member in the stands and refuses the 31st", () => {
    const { core } = makeRoom();
    joinAll(core, 10 + MAX_SPECTATORS);
    expect(core.roomView().players).toHaveLength(10);
    expect(core.roomView().spectators).toHaveLength(MAX_SPECTATORS);
    expect(core.join(guest(99), T0)).toEqual({ ok: false, code: CLOSE.roomFull });
    expect(core.join(guest(98, { mod: true }), T0).ok).toBe(true);
  });

  it("gives several tabs of one identity the same member", () => {
    const { core } = makeRoom();
    const a = core.join(guest(1), T0);
    const b = core.join(guest(1), T0);
    expect(a).toEqual(b);
    expect(core.roomView().players).toHaveLength(1);
  });

  it("makes display names unique within the room", () => {
    const { core } = makeRoom();
    joinAll(core, 1);
    core.join(guest(2, { name: "Player 1" }), T0);
    expect(core.roomView().players.map((p) => p.name)).toEqual(["Player 1", "Player 1 2"]);
  });

  it("refuses guests in public rooms and kicked identities", () => {
    const { core } = makeRoom({ visibility: "public" });
    expect(core.join(guest(5), T0)).toEqual({ ok: false, code: CLOSE.accountRequired });
    const [host, other] = joinAll(core, 2, T0, user);
    expect(core.handle(host as string, { t: "kick", pid: other as string }, T0)).toBeNull();
    expect(core.join(user(2), T0)).toEqual({ ok: false, code: CLOSE.kicked });
  });

  it("lets members stand up and sit down", () => {
    const { core } = makeRoom();
    const [a] = joinAll(core, 1) as [string];
    expect(core.handle(a, { t: "sit" }, T0)).toBe("already_seated");
    expect(core.handle(a, { t: "stand" }, T0)).toBeNull();
    expect(core.handle(a, { t: "stand" }, T0)).toBe("not_seated");
    expect(core.roomView().spectators.map((s) => s.pid)).toEqual([a]);
    expect(core.handle(a, { t: "sit" }, T0)).toBeNull();
  });

  it("frees a lobby seat 60 s after its member disconnects", () => {
    const { core } = makeRoom();
    const [, b] = joinAll(core, 2) as [string, string];
    core.markGone(b, T0);
    core.tick(T0 + ROOM_TIMING.lobbySeatGraceMs - 1);
    expect(core.roomView().players).toHaveLength(2);
    core.tick(T0 + ROOM_TIMING.lobbySeatGraceMs);
    expect(core.roomView().players).toHaveLength(1);
  });

  it("drops spectators as soon as their last tab closes", () => {
    const { core } = startedRoom(5);
    const late = core.join(guest(6), T0);
    expect(late.ok && core.roomView().spectators).toHaveLength(1);
    if (late.ok) core.markGone(late.pid, T0);
    expect(core.roomView().spectators).toHaveLength(0);
  });

  it("forgets members whose sockets vanished during a restart", () => {
    const { core, room } = startedRoom(5);
    const late = core.join(guest(6), T0);
    expect(late.ok).toBe(true);
    const online = core.room.game?.seats.slice(1) ?? [];
    const restarted = new RoomCore(secretHitler, testDeps(), structuredClone(room), {
      log: [],
      history: [],
      chat: [],
      online,
      now: T0 + SECOND,
    });
    expect(restarted.roomView().spectators).toHaveLength(0);
    expect(restarted.member(pidAt(restarted, 0))?.goneSince).toBe(T0 + SECOND);
    expect(restarted.roomView().players[0]?.connected).toBe(false);
  });
});

describe("starting a private game", () => {
  it("only lets the host start, with 5 to 10 connected players", () => {
    const { core } = makeRoom();
    const pids = joinAll(core, 4) as [string, string, string, string];
    expect(core.handle(pids[1], { t: "start" }, T0)).toBe("not_host");
    expect(core.handle(pids[0], { t: "start" }, T0)).toBe("not_enough_players");
    const [fifth] = joinAll(core, 5).slice(4) as [string];
    core.markGone(fifth, T0);
    expect(core.handle(pids[0], { t: "start" }, T0)).toBe("players_disconnected");
    core.join(guest(5), T0);
    expect(core.handle(pids[0], { t: "start" }, T0)).toBeNull();
    expect(core.room.status).toBe("playing");
  });

  it("shuffles the seats and records the setup events as move 0", () => {
    const { core } = makeRoom();
    const pids = joinAll(core, 7);
    core.drain();
    core.handle(pids[0] as string, { t: "start" }, T0);
    const out = core.drain();
    expect([...(core.room.game?.seats ?? [])].sort()).toEqual([...pids].sort());
    expect(out.notes.map((n) => n.kind)).toEqual(["snapshot"]);
    expect(out.moves).toHaveLength(1);
    expect(out.moves[0]).toMatchObject({ idx: 0, seat: null, action: null });
    expect(out.moves[0]?.events[0]).toMatchObject({ type: "gameStarted", playerCount: 7 });
  });

  it("is started by the countdown in public rooms, not by the host", () => {
    const { core } = makeRoom({ visibility: "public", settings: { minPlayers: 5 } });
    const pids = joinAll(core, 4, T0, user);
    expect(core.handle(pids[0] as string, { t: "start" }, T0)).toBe("private_only");
    expect(core.roomView().startsAt).toBeNull();
    joinAll(core, 5, T0 + SECOND, user);
    expect(core.roomView().startsAt).toBe(T0 + SECOND + ROOM_TIMING.countdownMs);
    expect(core.nextWakeup(T0 + SECOND)).toBe(T0 + SECOND + ROOM_TIMING.countdownMs);
    core.tick(T0 + SECOND + ROOM_TIMING.countdownMs);
    expect(core.room.status).toBe("playing");
  });

  it("cancels the countdown when a player leaves and shortens it at 10 players", () => {
    const { core } = makeRoom({ visibility: "public", settings: { minPlayers: 5 } });
    const pids = joinAll(core, 5, T0, user);
    core.handle(pids[4] as string, { t: "stand" }, T0);
    expect(core.roomView().startsAt).toBeNull();
    core.handle(pids[4] as string, { t: "sit" }, T0);
    joinAll(core, 10, T0 + 2 * SECOND, user);
    expect(core.roomView().startsAt).toBe(T0 + 2 * SECOND + ROOM_TIMING.fullCountdownMs);
  });
});

describe("game actions", () => {
  it("refuses actions from spectators, stale turns and illegal moves", () => {
    const { core } = startedRoom(5);
    const late = core.join(guest(6), T0);
    const s = state(core);
    const nominate = legalActions(s, s.president)[0] as Action;
    if (late.ok) {
      expect(core.handle(late.pid, { t: "action", turn: turn(core), action: nominate }, T0)).toBe(
        "not_a_player",
      );
    }
    const other = (s.president + 1) % 5;
    expect(act(core, other, nominate)).toBe("NOT_YOUR_TURN");
    expect(
      core.handle(pidAt(core, s.president), { t: "action", turn: 99, action: nominate }, T0),
    ).toBe("stale_turn");
  });

  it("bumps the turn at each new decision, not at each vote", () => {
    const { core } = startedRoom(5);
    expect(turn(core)).toBe(1);
    const s = state(core);
    act(core, s.president, legalActions(s, s.president)[0] as Action);
    expect(turn(core)).toBe(2);
    const voters = pendingActors(state(core));
    for (const seat of voters.slice(0, -1)) {
      expect(act(core, seat, { type: "vote", ja: true })).toBeNull();
      expect(turn(core)).toBe(2);
    }
    act(core, voters.at(-1) as number, { type: "vote", ja: true });
    expect(turn(core)).toBe(3);
  });

  it("plays a whole game and reports a replayable result", () => {
    const { core } = startedRoom(7);
    core.drain();
    const moves = playToEnd(core);
    const out = core.drain();
    expect(core.room.status).toBe("ended");
    expect(core.roomView().result?.kind).toBe("finished");
    expect(out.outbox).toHaveLength(1);
    const payload = gameResultPayloadSchema.parse(out.outbox[0]?.payload);
    expect(payload.log.moves).toHaveLength(moves);
    expect(payload.players.filter((p) => p.won).length).toBeGreaterThan(0);
    const replayed = replay(7, payload.log.seed, payload.log.moves);
    expect(replayed).toEqual(state(core));
    expect(core.purgeAt()).toBe(T0 + ROOM_TIMING.purgeAfterEndMs);
  });
});

describe("timers", () => {
  it("has no deadline with timers off", () => {
    const { core } = startedRoom(5);
    expect(core.roomView().game?.deadline).toBeNull();
    core.tick(T0 + 24 * 3600 * SECOND);
    expect(turn(core)).toBe(1);
  });

  it("plays the default action when a decision times out", () => {
    const { core } = startedRoom(5, { settings: { timers: "fast" } });
    expect(core.roomView().game?.deadline).toBe(T0 + 20 * SECOND);
    expect(core.nextWakeup(T0)).toBe(T0 + 20 * SECOND);
    core.tick(T0 + 20 * SECOND - 1);
    expect(state(core).phase.kind).toBe("nominate");
    core.drain();
    core.tick(T0 + 20 * SECOND);
    expect(state(core).phase.kind).toBe("vote");
    expect(core.drain().moves[0]?.auto).toBe(true);
    expect(core.roomView().game?.deadline).toBe(T0 + 35 * SECOND);
    // Nobody votes: every ballot defaults to Nein.
    core.tick(T0 + 35 * SECOND);
    expect(state(core).lastVote?.votes.every((v) => v === false)).toBe(true);
  });
});

describe("away players in public games", () => {
  function publicGame() {
    // Relaxed timers (2 min to nominate) so deadlines never hide the 90 s away rule.
    const { core } = makeRoom({
      visibility: "public",
      settings: { minPlayers: 5, timers: "relaxed" },
    });
    const pids = joinAll(core, 5, T0, user);
    core.tick(T0 + ROOM_TIMING.countdownMs);
    expect(core.room.status).toBe("playing");
    return { core, pids, t1: T0 + ROOM_TIMING.countdownMs };
  }

  it("plays for a player after 90 s away and stops when they return", () => {
    const { core, t1 } = publicGame();
    const president = state(core).president;
    const pid = pidAt(core, president);
    core.markGone(pid, t1);
    core.tick(t1 + ROOM_TIMING.reconnectGraceMs - 1);
    expect(core.roomView().players[president]?.afk).toBe(false);
    core.tick(t1 + ROOM_TIMING.reconnectGraceMs);
    expect(core.roomView().players[president]?.afk).toBe(true);
    // It was their turn to nominate: the room played it.
    expect(state(core).phase.kind).toBe("vote");
    // Test pids are p1..p5 in join order, for users 1..5.
    core.join(user(Number(pid.slice(1))), t1 + ROOM_TIMING.reconnectGraceMs + 1);
    expect(core.roomView().players[president]?.afk).toBe(false);
  });

  it("is abandoned when under half the players stay connected for 3 minutes", () => {
    const { core, pids, t1 } = publicGame();
    for (const pid of pids.slice(0, 3)) core.markGone(pid, t1);
    // The host is among those who left: the host hand-over (60 s) comes first.
    expect(core.nextWakeup(t1)).toBe(t1 + ROOM_TIMING.hostGraceMs);
    core.tick(t1 + ROOM_TIMING.abandonAfterMs - 1);
    expect(core.room.status).toBe("playing");
    core.drain();
    core.tick(t1 + ROOM_TIMING.abandonAfterMs);
    expect(core.roomView().result).toEqual({ kind: "abandoned" });
    const payload = core.drain().outbox[0]?.payload;
    expect(payload?.players.every((p) => !p.won)).toBe(true);
  });

  it("marks the player the room played for as having left in the result", () => {
    const { core, t1 } = publicGame();
    const seat = 2;
    core.markGone(pidAt(core, seat), t1);
    const t2 = t1 + ROOM_TIMING.reconnectGraceMs;
    core.tick(t2);
    expect(core.roomView().players[seat]?.afk).toBe(true);
    core.drain();

    playToEnd(core, 7, t2);
    expect(core.roomView().result?.kind).toBe("finished");
    const payload = gameResultPayloadSchema.parse(core.drain().outbox[0]?.payload);
    expect(payload.players.map((p) => p.left)).toEqual([false, false, true, false, false]);
  });

  it("does not count a player who came back before the end as having left", () => {
    const { core, t1 } = publicGame();
    const pid = pidAt(core, 1);
    core.markGone(pid, t1);
    const t2 = t1 + ROOM_TIMING.reconnectGraceMs;
    core.tick(t2);
    core.join(user(Number(pid.slice(1))), t2 + 1);
    playToEnd(core, 7, t2 + 1);
    const payload = gameResultPayloadSchema.parse(core.drain().outbox[0]?.payload);
    expect(payload.players.every((p) => !p.left)).toBe(true);
  });
});

describe("private game controls", () => {
  it("lets the host play the turn of a player gone 60 s", () => {
    const { core, pids } = startedRoom(5);
    const host = pids[0] as string;
    const s = state(core);
    act(core, s.president, legalActions(s, s.president)[0] as Action);
    const seat = pendingActors(state(core)).find((x) => pidAt(core, x) !== host) as number;
    const target = pidAt(core, seat);
    expect(core.handle(host, { t: "forceTurn", pid: target }, T0)).toBe(
      "not_disconnected_long_enough",
    );
    core.markGone(target, T0);
    expect(core.handle(host, { t: "forceTurn", pid: target }, T0 + 59 * SECOND)).toBe(
      "not_disconnected_long_enough",
    );
    const bystander = pids.find((p) => p !== host && p !== target) as string;
    expect(core.handle(bystander, { t: "forceTurn", pid: target }, T0 + 60 * SECOND)).toBe(
      "not_host",
    );
    expect(core.handle(host, { t: "forceTurn", pid: target }, T0 + 60 * SECOND)).toBeNull();
    // The forced vote is the default: Nein.
    const after = state(core).phase;
    expect(after.kind === "vote" ? after.votes[seat] : "vote over").toBe(false);
    expect(core.handle(host, { t: "forceTurn", pid: target }, T0 + 61 * SECOND)).toBe(
      "not_their_turn",
    );
  });

  it("lets the host stop the game without a winner", () => {
    const { core, pids } = startedRoom(5);
    expect(core.handle(pids[1] as string, { t: "endGame" }, T0)).toBe("not_host");
    expect(core.handle(pids[0] as string, { t: "endGame" }, T0)).toBeNull();
    expect(core.roomView().result).toEqual({ kind: "abandoned" });
  });

  it("is abandoned after 6 hours with nobody connected", () => {
    const { core, pids } = startedRoom(5);
    for (const pid of pids) core.markGone(pid, T0);
    expect(core.nextWakeup(T0)).toBe(T0 + ROOM_TIMING.hostGraceMs);
    core.tick(T0 + ROOM_TIMING.privateIdleAbandonMs);
    expect(core.room.status).toBe("ended");
  });

  it("moves the host role to a player after the host is gone 60 s", () => {
    const { core, pids } = startedRoom(5);
    core.join(guest(6), T0);
    core.markGone(pids[0] as string, T0);
    core.tick(T0 + ROOM_TIMING.hostGraceMs);
    const hostPid = core.roomView().hostPid;
    expect(hostPid).not.toBe(pids[0]);
    expect(core.roomView().players.map((p) => p.pid)).toContain(hostPid);
  });
});

describe("kicks", () => {
  it("removes a lobby member and closes their sockets", () => {
    const { core } = makeRoom();
    const [host, other] = joinAll(core, 2) as [string, string];
    core.drain();
    expect(core.handle(other, { t: "kick", pid: host }, T0)).toBe("not_host");
    expect(core.handle(host, { t: "kick", pid: host }, T0)).toBe("invalid_message");
    expect(core.handle(host, { t: "kick", pid: other }, T0)).toBeNull();
    expect(core.drain().notes).toContainEqual({ kind: "close", pid: other, code: CLOSE.kicked });
    expect(core.roomView().players).toHaveLength(1);
  });

  it("has the room play for a kicked player", () => {
    const { core, pids } = startedRoom(5);
    const host = pids[0] as string;
    const president = state(core).president;
    const target = pidAt(core, president);
    if (target === host) return;
    expect(core.handle(host, { t: "kick", pid: target }, T0)).toBeNull();
    expect(state(core).phase.kind).toBe("vote");
    expect(core.roomView().players[president]?.afk).toBe(true);
  });

  it("marks a kicked player as having left in the result", () => {
    const { core, pids } = startedRoom(5);
    const host = pids[0] as string;
    const seat = core.room.game?.seats.findIndex((pid) => pid !== host) as number;
    expect(core.handle(host, { t: "kick", pid: pidAt(core, seat) }, T0)).toBeNull();
    core.drain();
    playToEnd(core);
    const payload = gameResultPayloadSchema.parse(core.drain().outbox[0]?.payload);
    expect(payload.players.filter((p) => p.left).map((p) => p.seat)).toEqual([seat]);
  });

  it("tells the lobby which identities a public room refuses, the latest 100", () => {
    const { core } = makeRoom({ visibility: "public" });
    const [host] = joinAll(core, 1, T0, user) as [string];
    core.drain();
    for (let n = 2; n <= 106; n++) {
      const joined = core.join(user(n), T0);
      if (!joined.ok) throw new Error(`join ${n} refused`);
      expect(core.handle(host, { t: "kick", pid: joined.pid }, T0)).toBeNull();
      if (n === 2) {
        expect(core.lobbyReport()?.excluded).toEqual(["u:u2"]);
        expect(core.drain().lobby).toBe(true);
      }
    }
    const excluded = core.lobbyReport()?.excluded ?? [];
    expect(excluded).toHaveLength(100);
    expect(excluded[0]).toBe("u:u7");
    expect(excluded.at(-1)).toBe("u:u106");
    expect(core.lobbyReport()?.members).toEqual(["u:u1"]);
  });
});

describe("chat", () => {
  it("lets everyone talk in the lobby, with rate limits", () => {
    const { core } = makeRoom();
    const [a] = joinAll(core, 2) as [string];
    for (let i = 0; i < 3; i++)
      expect(core.handle(a, { t: "chat", text: `hi ${i}` }, T0)).toBeNull();
    expect(core.handle(a, { t: "chat", text: "again" }, T0)).toBe("chat_too_fast");
    expect(core.handle(a, { t: "chat", text: "   " }, T0 + 5 * SECOND)).toBe("chat_invalid");
    expect(core.handle(a, { t: "chat", text: "later" }, T0 + 5 * SECOND)).toBeNull();
  });

  it("closes the socket of a member who floods", () => {
    const { core } = makeRoom();
    const [a] = joinAll(core, 1) as [string];
    for (let i = 0; i < 3; i++) core.handle(a, { t: "chat", text: "x" }, T0);
    core.drain();
    for (let i = 0; i < 8; i++) core.handle(a, { t: "chat", text: "x" }, T0 + i);
    expect(core.drain().notes).toContainEqual({ kind: "close", pid: a, code: CLOSE.flood });
  });

  it("applies a 2 s slow mode in public rooms", () => {
    const { core } = makeRoom({ visibility: "public" });
    const [a] = joinAll(core, 1, T0, user) as [string];
    expect(core.handle(a, { t: "chat", text: "one" }, T0)).toBeNull();
    expect(core.handle(a, { t: "chat", text: "two" }, T0 + 1999)).toBe("chat_too_fast");
    expect(core.handle(a, { t: "chat", text: "two" }, T0 + 2000)).toBeNull();
  });

  it("silences spectators, and the government during the legislative session", () => {
    const { core } = startedRoom(5);
    const late = core.join(guest(6), T0);
    if (late.ok)
      expect(core.handle(late.pid, { t: "chat", text: "hi" }, T0)).toBe("chat_not_allowed");
    electGovernment(core);
    const s = state(core);
    expect(s.phase.kind).toBe("presidentDiscard");
    if (s.phase.kind !== "presidentDiscard") return;
    const government = [s.president, s.phase.chancellor];
    const other = [0, 1, 2, 3, 4].find((seat) => !government.includes(seat)) as number;
    for (const seat of government) {
      expect(core.handle(pidAt(core, seat), { t: "chat", text: "psst" }, T0)).toBe(
        "chat_not_allowed",
      );
    }
    expect(core.handle(pidAt(core, other), { t: "chat", text: "who?" }, T0)).toBeNull();
  });

  it("hides messages from blocked identities", () => {
    const { core } = makeRoom();
    const [, b] = joinAll(core, 2) as [string, string];
    const c = core.join(guest(3, { blocks: ["g:g2"] }), T0);
    core.handle(b, { t: "chat", text: "hello" }, T0);
    if (!c.ok) throw new Error("join refused");
    const welcome = core.welcomeFor(c.pid, T0);
    expect(welcome?.chat.some((m) => m.kind === "player")).toBe(false);
    expect(core.welcomeFor(b, T0)?.chat.some((m) => m.kind === "player")).toBe(true);
  });

  it("knows who may chat in each phase (adapter)", () => {
    const { core } = startedRoom(5);
    const s = structuredClone(state(core));
    expect(secretHitler.canChat(s, null)).toBe(false);
    expect(secretHitler.canChat(s, 0)).toBe(true);
    s.alive[0] = false;
    expect(secretHitler.canChat(s, 0)).toBe(false);
  });
});

describe("after the game", () => {
  it("lets the host start a rematch with the same players", () => {
    const { core, pids } = startedRoom(5);
    const seats = [...(core.room.game?.seats ?? [])];
    playToEnd(core);
    expect(core.handle(pids[1] as string, { t: "rematch" }, T0)).toBe("not_host");
    core.drain();
    expect(core.handle(pids[0] as string, { t: "rematch" }, T0)).toBeNull();
    expect(core.drain().notes.map((n) => n.kind)).toEqual(["snapshot"]);
    expect(core.roomView()).toMatchObject({ status: "lobby", result: null, game: null });
    expect(core.roomView().players.map((p) => p.pid)).toEqual(seats);
    core.handle(pids[0] as string, { t: "start" }, T0);
    expect(core.room.game?.number).toBe(2);
  });

  it("closes an empty lobby after 30 minutes", () => {
    const { core } = makeRoom();
    expect(core.purgeAt()).toBe(T0 + ROOM_TIMING.purgeEmptyLobbyMs);
    const [a] = joinAll(core, 1) as [string];
    expect(core.purgeAt()).toBeNull();
    core.markGone(a, T0 + SECOND);
    expect(core.purgeAt()).toBe(T0 + SECOND + ROOM_TIMING.purgeEmptyLobbyMs);
  });
});

describe("what clients receive", () => {
  it("merges notes into one message per kind", () => {
    const { core } = startedRoom(5);
    core.drain();
    const s = state(core);
    act(core, s.president, legalActions(s, s.president)[0] as Action);
    expect(core.drain().notes.map((n) => n.kind)).toEqual(["room", "game"]);
  });

  it("builds strict, secret-free messages for players and spectators", () => {
    const { core } = startedRoom(5);
    const late = core.join(guest(6), T0);
    expect(roomViewSchema.safeParse(core.roomView()).success).toBe(true);
    expect(JSON.stringify(core.roomView())).not.toMatch(/"g:|"sub"|"key"/);
    const player = core.welcomeFor(pidAt(core, 0), T0);
    expect(serverMessageSchema.safeParse(player).success).toBe(true);
    expect(player?.game?.view.me?.seat).toBe(0);
    if (late.ok) {
      const spectator = core.welcomeFor(late.pid, T0);
      expect(serverMessageSchema.safeParse(spectator).success).toBe(true);
      expect(spectator?.game?.view.me).toBeNull();
      expect(spectator?.game?.view.roles).toBeNull();
    }
    const update = core.gameUpdateFor(pidAt(core, 1), []);
    expect(serverMessageSchema.safeParse(update).success).toBe(true);
  });

  it("reports public rooms to the lobby, with members, until they end", () => {
    const priv = makeRoom();
    expect(priv.core.lobbyReport()).toBeNull();
    const { core } = makeRoom({ visibility: "public" });
    joinAll(core, 2, T0, user);
    expect(core.lobbyReport()).toMatchObject({
      code: "BCDFG",
      players: 2,
      members: ["u:u1", "u:u2"],
      excluded: [],
    });
    expect(core.drain().lobby).toBe(true);
    expect(core.drain().lobby).toBe(false);
  });

  it("only flags the lobby when what it shows changes", () => {
    const { core } = makeRoom({ visibility: "public", settings: { minPlayers: 5 } });
    joinAll(core, 5, T0, user);
    core.tick(T0 + ROOM_TIMING.countdownMs);
    expect(core.drain().lobby).toBe(true);
    const s = state(core);
    act(core, s.president, legalActions(s, s.president)[0] as Action, T0 + ROOM_TIMING.countdownMs);
    expect(core.drain().lobby).toBe(false);
    core.handle(pidAt(core, 0), { t: "chat", text: "hi" }, T0 + ROOM_TIMING.countdownMs);
    expect(core.drain().lobby).toBe(false);
  });
});
