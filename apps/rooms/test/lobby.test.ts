import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import type { LobbyMessage, LobbyRoomReport } from "@sh/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EXPIRY_MS, LOBBY_NAME, PERSIST_INTERVAL_MS } from "../src/lobby/Lobby";

const MINUTE = 60_000;

type LobbyStub = ReturnType<typeof env.LOBBY.getByName>;

/** A fresh lobby per test: the real one is `LOBBY_NAME`, shared by everyone. */
function freshLobby(): LobbyStub {
  return env.LOBBY.getByName(`t-${crypto.randomUUID()}`);
}

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
    members: ["u:secret-a", "u:secret-b"],
    excluded: ["u:secret-kicked"],
    ...overrides,
  };
}

/** A report as rooms sent it before `excluded` existed. */
function withoutExcluded(report: LobbyRoomReport): Omit<LobbyRoomReport, "excluded"> {
  const older: Partial<LobbyRoomReport> = { ...report };
  delete older.excluded;
  return older as Omit<LobbyRoomReport, "excluded">;
}

/** Pins the clock seen by the Lobby (it runs in the test isolate). */
function setNow(ms: number): void {
  vi.spyOn(Date, "now").mockReturnValue(ms);
}

function storedRows(stub: LobbyStub) {
  return runInDurableObject(stub, (_lobby, state) =>
    state.storage.sql
      .exec<{
        code: string;
        report: string;
        last_seen: number;
      }>("SELECT code, report, last_seen FROM rooms ORDER BY code")
      .toArray(),
  );
}

interface Viewer {
  socket: WebSocket;
  next(): Promise<string>;
  nextList(): Promise<LobbyMessage>;
  expectSilence(): Promise<void>;
}

async function connectViewer(stub: LobbyStub): Promise<Viewer> {
  const res = await stub.fetch("https://rooms.test/lobby", { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const socket = res.webSocket;
  if (!socket) throw new Error("no WebSocket in the 101 response");

  const queue: string[] = [];
  const waiting: ((data: string) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : "<binary>";
    const resolve = waiting.shift();
    if (resolve) resolve(data);
    else queue.push(data);
  });
  socket.accept();

  const next = (): Promise<string> => {
    const queued = queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(deliver), 1);
        reject(new Error("no message within 2 s"));
      }, 2_000);
      const deliver = (data: string): void => {
        clearTimeout(timer);
        resolve(data);
      };
      waiting.push(deliver);
    });
  };
  return {
    socket,
    next,
    async nextList() {
      const raw = await next();
      // Whatever reaches a viewer must never carry room members or exclusions.
      expect(raw).not.toContain("members");
      expect(raw).not.toContain("excluded");
      expect(raw).not.toContain("u:secret");
      return JSON.parse(raw) as LobbyMessage;
    },
    async expectSilence() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(queue).toEqual([]);
    },
  };
}

/**
 * The error an RPC call fails with. Vitest's `.rejects` inspects the promise,
 * and every property read on an RPC promise starts a pipelined call that then
 * rejects unhandled, so only `await` touches it here.
 */
async function rpcError(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("expected the RPC call to fail");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Lobby: registry", () => {
  it("is addressed by a fixed name", () => {
    expect(LOBBY_NAME).toBe("global");
  });

  it("lists reported rooms without their members or exclusions", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 4, startsAt: 1_700_000_000_000 }));

    const list = await lobby.list();
    expect(list).toEqual([
      {
        code: "BCDFG",
        lang: "fr",
        status: "lobby",
        players: 4,
        maxPlayers: 10,
        minPlayers: 5,
        timers: "standard",
        startsAt: 1_700_000_000_000,
      },
    ]);
    expect(JSON.stringify(list)).not.toContain("u:secret");
  });

  it("accepts a report without exclusions (rooms that predate them)", async () => {
    const lobby = freshLobby();
    await lobby.report(withoutExcluded(room("BCDFG")) as LobbyRoomReport);
    expect((await lobby.list()).map((entry) => entry.code)).toEqual(["BCDFG"]);
    expect(await lobby.quickMatch({ identity: "u:me", lang: "fr", blocks: [] })).toEqual({
      code: "BCDFG",
    });
  });

  it("replaces a room's entry on its next report", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 2 }));
    await lobby.report(room("BCDFG", { players: 3, status: "playing" }));
    expect(await lobby.list()).toMatchObject([{ code: "BCDFG", players: 3, status: "playing" }]);
  });

  it("orders waiting rooms first, fullest first, then games in progress", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { status: "playing", players: 9 }));
    await lobby.report(room("HJKLM", { players: 3 }));
    await lobby.report(room("NPQRS", { players: 6 }));
    await lobby.report(room("TVWXZ", { status: "playing", players: 5 }));
    expect((await lobby.list()).map((entry) => entry.code)).toEqual([
      "NPQRS",
      "HJKLM",
      "BCDFG",
      "TVWXZ",
    ]);
  });

  it("removes a room and its stored row", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));
    await lobby.report(room("HJKLM"));
    await lobby.remove("BCDFG");
    await lobby.remove("NPQRS"); // unknown: no-op

    expect((await lobby.list()).map((entry) => entry.code)).toEqual(["HJKLM"]);
    expect((await storedRows(lobby)).map((row) => row.code)).toEqual(["HJKLM"]);
  });

  it("rejects invalid reports and stores nothing", async () => {
    const lobby = freshLobby();
    const invalid: unknown[] = [
      room("AEIOU"), // not a room code
      room("BCDFG", { players: 11 }),
      room("BCDFG", { members: ["alice"] }), // not an identity key
      room("BCDFG", { excluded: ["alice"] }),
      { ...room("BCDFG"), secret: true }, // strict: no extra fields
    ];
    for (const report of invalid) {
      expect(await rpcError(lobby.report(report as LobbyRoomReport))).toBeInstanceOf(Error);
    }
    expect(await rpcError(lobby.remove("nope"))).toBeInstanceOf(Error);
    expect(await lobby.list()).toEqual([]);
    expect(await storedRows(lobby)).toEqual([]);
  });
});

describe("Lobby: quick match", () => {
  it("picks the fullest open room in the player's language without blocked members", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 8, members: ["u:foe"] }));
    await lobby.report(room("HJKLM", { players: 7, lang: "en" }));
    await lobby.report(room("NPQRS", { players: 3 }));
    await lobby.report(room("TVWXZ", { players: 5 }));

    const pick = (blocks: string[]) => lobby.quickMatch({ identity: "u:me", lang: "fr", blocks });
    expect(await pick(["u:foe"])).toEqual({ code: "TVWXZ" });
  });

  it("never sends a player to a room that excluded them, even their own", async () => {
    const lobby = freshLobby();
    await lobby.report(
      room("BCDFG", { status: "playing", players: 7, members: ["u:me"], excluded: ["u:me"] }),
    );
    await lobby.report(room("HJKLM", { players: 8, excluded: ["u:me"] }));
    const match = (identity: string) => lobby.quickMatch({ identity, lang: "fr", blocks: [] });
    expect(await match("u:me")).toEqual({ code: null });
    expect(await match("u:other")).toEqual({ code: "HJKLM" });

    await lobby.report(room("NPQRS", { players: 1 }));
    expect(await match("u:me")).toEqual({ code: "NPQRS" });
  });

  it("skips a room with someone the player blocked, or who blocked them (sent in blocks)", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 8, members: ["u:blocked-me"] }));
    await lobby.report(room("HJKLM", { players: 2 }));
    expect(
      await lobby.quickMatch({ identity: "u:me", lang: "fr", blocks: ["u:blocked-me"] }),
    ).toEqual({ code: "HJKLM" });
  });

  it("returns null when nothing fits", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { status: "playing" }));
    expect(await lobby.quickMatch({ identity: "u:me", lang: "fr", blocks: [] })).toEqual({
      code: null,
    });
  });

  it("counts a matched player until the room reports, so the last seat is not given twice", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 4, maxPlayers: 5 }));

    expect(await lobby.quickMatch({ identity: "u:one", lang: "fr", blocks: [] })).toEqual({
      code: "BCDFG",
    });
    expect(await lobby.quickMatch({ identity: "u:two", lang: "fr", blocks: [] })).toEqual({
      code: null,
    });

    // A second room absorbs the overflow.
    await lobby.report(room("HJKLM", { players: 1 }));
    expect(await lobby.quickMatch({ identity: "u:two", lang: "fr", blocks: [] })).toEqual({
      code: "HJKLM",
    });
  });

  it("sends the same player to the same room without taking a second seat", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 3, maxPlayers: 5 }));

    const match = (identity: string) => lobby.quickMatch({ identity, lang: "fr", blocks: [] });
    expect(await match("u:one")).toEqual({ code: "BCDFG" });
    expect(await match("u:one")).toEqual({ code: "BCDFG" });
    expect(await match("u:two")).toEqual({ code: "BCDFG" });
    expect(await match("u:three")).toEqual({ code: null });
  });

  it("forgets optimistic seats when the room reports again", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 4, maxPlayers: 5 }));
    await lobby.quickMatch({ identity: "u:one", lang: "fr", blocks: [] });

    // u:one never arrived: the room reports the same 4 players.
    await lobby.report(room("BCDFG", { players: 4, maxPlayers: 5 }));
    expect(await lobby.quickMatch({ identity: "u:two", lang: "fr", blocks: [] })).toEqual({
      code: "BCDFG",
    });
  });

  it("treats an optimistic seat as a member for blocks", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 2 }));
    await lobby.quickMatch({ identity: "u:foe", lang: "fr", blocks: [] });
    expect(await lobby.quickMatch({ identity: "u:me", lang: "fr", blocks: ["u:foe"] })).toEqual({
      code: null,
    });
  });

  it("rejects an invalid request", async () => {
    const lobby = freshLobby();
    const error = await rpcError(lobby.quickMatch({ identity: "me", lang: "fr", blocks: [] }));
    expect(error).toBeInstanceOf(Error);
  });
});

describe("Lobby: moderation lookup", () => {
  it("lists the rooms an identity is in, or was just matched to", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { members: ["u:a", "u:b"] }));
    await lobby.report(room("HJKLM", { members: ["u:b"], players: 1 }));
    await lobby.report(room("NPQRS", { members: ["u:c"], status: "playing", players: 5 }));
    expect((await lobby.roomsWith("u:b")).sort()).toEqual(["BCDFG", "HJKLM"]);
    expect(await lobby.roomsWith("u:c")).toEqual(["NPQRS"]);
    // Excluded is not membership.
    expect(await lobby.roomsWith("u:secret-kicked")).toEqual([]);

    // Quick match sent u:new to the fullest open room; it has not reported them yet.
    expect(await lobby.quickMatch({ identity: "u:new", lang: "fr", blocks: [] })).toEqual({
      code: "BCDFG",
    });
    expect(await lobby.roomsWith("u:new")).toEqual(["BCDFG"]);
  });

  it("rejects an invalid identity", async () => {
    const lobby = freshLobby();
    expect(await rpcError(lobby.roomsWith("nobody"))).toBeInstanceOf(Error);
  });
});

describe("Lobby: viewers", () => {
  it("refuses plain HTTP with 426", async () => {
    const res = await freshLobby().fetch("https://rooms.test/lobby");
    expect(res.status).toBe(426);
  });

  it("sends the list on connect, then each change", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));
    const viewer = await connectViewer(lobby);

    const first = await viewer.nextList();
    expect(first.t).toBe("lobby");
    expect(first.rooms.map((entry) => entry.code)).toEqual(["BCDFG"]);
    expect(typeof first.serverTime).toBe("number");

    await lobby.report(room("HJKLM", { players: 5 }));
    expect((await viewer.nextList()).rooms.map((entry) => entry.code)).toEqual(["HJKLM", "BCDFG"]);

    await lobby.remove("HJKLM");
    expect((await viewer.nextList()).rooms.map((entry) => entry.code)).toEqual(["BCDFG"]);
  });

  it("broadcasts at most once per second, the rest on the alarm", async () => {
    // Far enough ahead that the deferred alarm cannot fire on its own during the test.
    setNow(Date.now() + 60 * MINUTE);
    const lobby = freshLobby();
    const viewer = await connectViewer(lobby);
    expect((await viewer.nextList()).rooms).toEqual([]);

    await lobby.report(room("BCDFG"));
    expect((await viewer.nextList()).rooms).toHaveLength(1);

    await lobby.report(room("HJKLM"));
    await lobby.report(room("NPQRS"));
    await viewer.expectSilence();

    expect(await runDurableObjectAlarm(lobby)).toBe(true);
    expect((await viewer.nextList()).rooms).toHaveLength(3);
    await viewer.expectSilence();
  });

  it("does not broadcast changes viewers cannot see", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));
    const viewer = await connectViewer(lobby);
    await viewer.nextList();

    await lobby.report(room("BCDFG", { members: ["u:secret-c"] }));
    await lobby.report(room("BCDFG", { members: ["u:secret-c"] })); // keep-alive
    await lobby.report(room("BCDFG", { members: ["u:secret-c"], excluded: ["u:secret-d"] }));
    await viewer.expectSilence();
  });

  it("answers keep-alive pings", async () => {
    const viewer = await connectViewer(freshLobby());
    await viewer.nextList();
    viewer.socket.send("ping");
    expect(await viewer.next()).toBe("pong");
  });

  it("ignores anything else a viewer sends", async () => {
    const lobby = freshLobby();
    const viewer = await connectViewer(lobby);
    await viewer.nextList();
    viewer.socket.send(JSON.stringify({ t: "lobby", rooms: [] }));
    await viewer.expectSilence();
    await lobby.report(room("BCDFG"));
    expect((await viewer.nextList()).rooms).toHaveLength(1);
  });
});

describe("Lobby: expiry and storage", () => {
  it("drops a room that stopped reporting for 11 minutes", async () => {
    const t0 = Date.now();
    setNow(t0);
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));
    const viewer = await connectViewer(lobby);
    await viewer.nextList();

    setNow(t0 + EXPIRY_MS - 1);
    expect(await runDurableObjectAlarm(lobby)).toBe(true);
    expect(await lobby.list()).toHaveLength(1);

    setNow(t0 + EXPIRY_MS);
    expect(await runDurableObjectAlarm(lobby)).toBe(true);
    expect((await viewer.nextList()).rooms).toEqual([]);
    expect(await lobby.list()).toEqual([]);
    expect(await storedRows(lobby)).toEqual([]);
  });

  it("never matches an expired room, even before the alarm runs", async () => {
    const t0 = Date.now();
    setNow(t0);
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));

    setNow(t0 + EXPIRY_MS + MINUTE);
    expect(await lobby.quickMatch({ identity: "u:me", lang: "fr", blocks: [] })).toEqual({
      code: null,
    });
  });

  it("keeps a keep-alive in memory unless the stored row is 4 minutes old", async () => {
    const t0 = Date.now();
    setNow(t0);
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));
    expect((await storedRows(lobby))[0]?.last_seen).toBe(t0);

    // Keep-alive after 3 minutes: no write...
    setNow(t0 + 3 * MINUTE);
    await lobby.report(room("BCDFG"));
    expect((await storedRows(lobby))[0]?.last_seen).toBe(t0);

    // ...but the room's clock moved: still listed 11 minutes after t0.
    setNow(t0 + EXPIRY_MS + MINUTE);
    expect(await lobby.list()).toHaveLength(1);

    // A keep-alive once the row is 4 minutes old is written.
    setNow(t0 + 3 * MINUTE + PERSIST_INTERVAL_MS);
    await lobby.report(room("BCDFG"));
    expect((await storedRows(lobby))[0]?.last_seen).toBe(t0 + 3 * MINUTE + PERSIST_INTERVAL_MS);
  });

  it("writes a changed report at once, members included", async () => {
    const t0 = Date.now();
    setNow(t0);
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));

    setNow(t0 + MINUTE);
    await lobby.report(room("BCDFG", { members: ["u:secret-a", "u:secret-c"] }));
    const [row] = await storedRows(lobby);
    expect(row?.last_seen).toBe(t0 + MINUTE);
    expect(row?.report).toContain("u:secret-c");

    // Same members in another order is not a change.
    setNow(t0 + 2 * MINUTE);
    await lobby.report(room("BCDFG", { members: ["u:secret-c", "u:secret-a"] }));
    expect((await storedRows(lobby))[0]?.last_seen).toBe(t0 + MINUTE);
  });

  it("writes a changed exclusion list at once, whatever its order", async () => {
    const t0 = Date.now();
    setNow(t0);
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));

    setNow(t0 + MINUTE);
    const excluded = ["u:secret-kicked", "u:secret-x"];
    await lobby.report(room("BCDFG", { excluded }));
    const [row] = await storedRows(lobby);
    expect(row?.last_seen).toBe(t0 + MINUTE);
    expect(row?.report).toContain("u:secret-x");

    setNow(t0 + 2 * MINUTE);
    await lobby.report(room("BCDFG", { excluded: [...excluded].reverse() }));
    expect((await storedRows(lobby))[0]?.last_seen).toBe(t0 + MINUTE);
  });

  it("reads back rows stored before exclusions existed", async () => {
    const lobby = freshLobby();
    const older = withoutExcluded(room("HJKLM", { members: ["u:one"] }));
    await runInDurableObject(lobby, (_lobby, state) => {
      state.storage.sql.exec(
        "INSERT INTO rooms (code, report, last_seen) VALUES (?, ?, ?)",
        "HJKLM",
        JSON.stringify(older),
        Date.now(),
      );
    });

    await evictDurableObject(lobby);

    expect((await lobby.list()).map((entry) => entry.code)).toEqual(["HJKLM"]);
    expect(await lobby.quickMatch({ identity: "u:one", lang: "fr", blocks: [] })).toEqual({
      code: "HJKLM",
    });
  });

  it("survives eviction, and hibernated viewers still get updates", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG", { players: 6, members: ["u:one"] }));
    await lobby.report(room("HJKLM", { players: 3 }));
    const viewer = await connectViewer(lobby);
    await viewer.nextList();

    await evictDurableObject(lobby);

    expect((await lobby.list()).map((entry) => entry.code)).toEqual(["BCDFG", "HJKLM"]);
    expect(await lobby.quickMatch({ identity: "u:one", lang: "fr", blocks: [] })).toEqual({
      code: "BCDFG",
    });
    await lobby.report(room("NPQRS", { players: 1 }));
    expect((await viewer.nextList()).rooms.map((entry) => entry.code)).toEqual([
      "BCDFG",
      "HJKLM",
      "NPQRS",
    ]);
  });

  it("drops rows it cannot read back after an upgrade", async () => {
    const lobby = freshLobby();
    await lobby.report(room("BCDFG"));
    await runInDurableObject(lobby, (_lobby, state) => {
      state.storage.sql.exec(
        "INSERT INTO rooms (code, report, last_seen) VALUES (?, ?, ?)",
        "HJKLM",
        '{"code":"HJKLM","seats":4}',
        Date.now(),
      );
    });

    await evictDurableObject(lobby);

    expect((await lobby.list()).map((entry) => entry.code)).toEqual(["BCDFG"]);
    expect((await storedRows(lobby)).map((row) => row.code)).toEqual(["BCDFG"]);
  });
});
