import type { LobbyRoomReport, QuickMatchRequest } from "@sh/protocol";
import { describe, expect, it } from "vitest";

import { compareRooms, pickRoom } from "../src/lobby/matchmaking";

function room(code: string, overrides: Partial<LobbyRoomReport> = {}): LobbyRoomReport {
  return {
    code,
    lang: "fr",
    status: "lobby",
    players: 2,
    maxPlayers: 10,
    minPlayers: 5,
    timers: "standard",
    startsAt: null,
    members: [],
    excluded: [],
    ...overrides,
  };
}

function request(overrides: Partial<QuickMatchRequest> = {}): QuickMatchRequest {
  return { identity: "u:me", lang: "fr", blocks: [], ...overrides };
}

describe("pickRoom", () => {
  it("returns null when there is no room", () => {
    expect(pickRoom([], request())).toBeNull();
  });

  it("sends a player back to the room they are already in, even if it is full or playing", () => {
    const rooms = [
      room("BCDFG", { players: 6 }),
      room("HJKLM", { status: "playing", players: 7, maxPlayers: 7, members: ["u:me"] }),
    ];
    expect(pickRoom(rooms, request())).toBe("HJKLM");
  });

  it("rejoins a room in another language and ignores blocks for it", () => {
    const rooms = [room("BCDFG", { lang: "en", members: ["u:me", "u:foe"] })];
    expect(pickRoom(rooms, request({ lang: "fr", blocks: ["u:foe"] }))).toBe("BCDFG");
  });

  it("prefers a game in progress when the player is in two rooms", () => {
    const rooms = [
      room("BCDFG", { players: 9, members: ["u:me"] }),
      room("HJKLM", { status: "playing", players: 5, members: ["u:me"] }),
    ];
    expect(pickRoom(rooms, request())).toBe("HJKLM");
  });

  it("only offers rooms in the requested language", () => {
    const rooms = [room("BCDFG", { lang: "en", players: 8 }), room("HJKLM", { players: 1 })];
    expect(pickRoom(rooms, request())).toBe("HJKLM");
    expect(pickRoom(rooms, request({ lang: "en" }))).toBe("BCDFG");
  });

  it("skips full rooms", () => {
    const rooms = [room("BCDFG", { players: 7, maxPlayers: 7 }), room("HJKLM", { players: 3 })];
    expect(pickRoom(rooms, request())).toBe("HJKLM");
    expect(pickRoom([rooms[0]!], request())).toBeNull();
  });

  it("skips rooms that are already playing", () => {
    expect(pickRoom([room("BCDFG", { status: "playing", players: 5 })], request())).toBeNull();
  });

  it("skips rooms with a blocked member, players or spectators alike", () => {
    const rooms = [
      room("BCDFG", { players: 8, members: ["u:a", "u:foe"] }),
      room("HJKLM", { players: 4, members: ["u:b"] }),
    ];
    expect(pickRoom(rooms, request({ blocks: ["u:foe"] }))).toBe("HJKLM");
    expect(pickRoom(rooms, request({ blocks: ["u:foe", "u:b"] }))).toBeNull();
  });

  it("keeps apart players who blocked each other (the website sends both directions)", () => {
    // u:foe blocked u:me; u:me never blocked u:foe. The website adds u:foe to u:me's blocks.
    const rooms = [
      room("BCDFG", { players: 8, members: ["u:foe"] }),
      room("HJKLM", { players: 2, members: ["u:b"] }),
    ];
    expect(pickRoom(rooms, request({ blocks: ["u:foe"] }))).toBe("HJKLM");
  });

  it("never offers a room that excluded the player", () => {
    const rooms = [
      room("BCDFG", { players: 8, excluded: ["u:me"] }),
      room("HJKLM", { players: 3 }),
    ];
    expect(pickRoom(rooms, request())).toBe("HJKLM");
    expect(pickRoom([rooms[0]!], request())).toBeNull();
    expect(pickRoom([rooms[0]!], request({ identity: "u:other" }))).toBe("BCDFG");
  });

  it("does not send a kicked player back to their own room", () => {
    // Kicked from a game in progress: still a member of the game record.
    const rooms = [
      room("BCDFG", { status: "playing", players: 7, members: ["u:me"], excluded: ["u:me"] }),
      room("HJKLM", { players: 3 }),
    ];
    expect(pickRoom(rooms, request())).toBe("HJKLM");
    expect(pickRoom([rooms[0]!], request())).toBeNull();
  });

  it("picks the fullest room first", () => {
    const rooms = [room("BCDFG", { players: 3 }), room("HJKLM", { players: 6 })];
    expect(pickRoom(rooms, request())).toBe("HJKLM");
  });

  it("breaks ties on the earliest countdown, a running countdown before none", () => {
    const rooms = [
      room("BCDFG", { players: 5 }),
      room("HJKLM", { players: 5, startsAt: 2_000 }),
      room("NPQRS", { players: 5, startsAt: 1_000 }),
    ];
    expect(pickRoom(rooms, request())).toBe("NPQRS");
    expect(pickRoom(rooms.slice(0, 2), request())).toBe("HJKLM");
  });

  it("breaks remaining ties on the code, whatever the input order", () => {
    const rooms = [room("NPQRS"), room("BCDFG"), room("HJKLM")];
    expect(pickRoom(rooms, request())).toBe("BCDFG");
    expect(pickRoom([...rooms].reverse(), request())).toBe("BCDFG");
  });
});

describe("compareRooms", () => {
  it("sorts fullest, then earliest countdown, then code", () => {
    const rooms = [
      room("TVWXZ", { players: 2 }),
      room("NPQRS", { players: 6 }),
      room("HJKLM", { players: 6, startsAt: 5 }),
      room("BCDFG", { players: 6 }),
    ];
    expect(rooms.sort(compareRooms).map((r) => r.code)).toEqual([
      "HJKLM",
      "BCDFG",
      "NPQRS",
      "TVWXZ",
    ]);
  });
});
