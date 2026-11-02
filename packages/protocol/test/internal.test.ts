import { describe, expect, it } from "vitest";

import {
  gameResultPayloadSchema,
  lobbyEntrySchema,
  lobbyRoomReportSchema,
  type GameResultPayload,
} from "../src";

const entry = {
  code: "BCDFG",
  lang: "fr",
  status: "lobby",
  players: 3,
  maxPlayers: 10,
  minPlayers: 5,
  timers: "standard",
  startsAt: null,
} as const;

function result(): Record<string, unknown> {
  return {
    gameId: "6f2c1d38-3f8e-4a43-9b7a-0d1c2e3f4a5b",
    room: "BCDFG",
    visibility: "public",
    lang: "fr",
    number: 1,
    startedAt: 1_800_000_000_000,
    endedAt: 1_800_000_900_000,
    result: { kind: "abandoned" },
    players: Array.from({ length: 5 }, (_, seat) => ({
      seat,
      kind: "user",
      sub: `u${seat}`,
      name: `Player ${seat}`,
      role: seat === 0 ? "hitler" : seat === 1 ? "fascist" : "liberal",
      alive: true,
      won: false,
    })),
    log: { game: "secret-hitler", stateVersion: 1, seed: [1, 2, 3, 4], moves: [] },
  };
}

describe("lobby room reports", () => {
  it("default `excluded` to an empty list (reports stored before it existed)", () => {
    const report = lobbyRoomReportSchema.parse({ ...entry, members: ["u:a"] });
    expect(report.excluded).toEqual([]);
  });

  it("only accept identity keys in `excluded`, at most 100", () => {
    const base = { ...entry, members: [] };
    expect(lobbyRoomReportSchema.safeParse({ ...base, excluded: ["u:kicked"] }).success).toBe(true);
    expect(lobbyRoomReportSchema.safeParse({ ...base, excluded: ["kicked"] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => `u:k${i}`);
    expect(lobbyRoomReportSchema.safeParse({ ...base, excluded: many }).success).toBe(false);
  });

  it("never let `excluded` into what viewers see", () => {
    expect(lobbyEntrySchema.safeParse({ ...entry, excluded: [] }).success).toBe(false);
  });
});

describe("game results", () => {
  it("default `left` to false (rooms that predate it)", () => {
    const payload: GameResultPayload = gameResultPayloadSchema.parse(result());
    expect(payload.players.every((p) => p.left === false)).toBe(true);
  });

  it("keep `left` when the room sends it", () => {
    const input = result();
    const players = input.players as Record<string, unknown>[];
    players[3] = { ...players[3], left: true };
    const payload = gameResultPayloadSchema.parse(input);
    expect(payload.players.map((p) => p.left)).toEqual([false, false, false, true, false]);
  });
});
