import { seededRandom } from "@sh/engine";
import { CLOSE, SIGNATURE_HEADER, gameResultPayloadSchema, verifyRequest } from "@sh/protocol";
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOM_TIMING } from "../src/room/room-core";
import type { GameRoom } from "../src/room/GameRoom";
import { Client, connectAll, createRoom, guestId, roomStub, userId } from "./helpers/worker";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Plays random legal actions from the clients' own views until every client sees the end. */
async function playOverSockets(clients: Client[], seed = 3, maxMoves = 1500): Promise<number> {
  const rand = seededRandom(seed);
  for (let moves = 0; moves < maxMoves; moves++) {
    if (clients.every((c) => c.view?.phase.kind === "over")) return moves;
    const actors = clients.filter((c) => (c.view?.me?.legal.length ?? 0) > 0);
    const actor = actors[Math.floor(rand() * actors.length)];
    if (!actor?.view?.me) throw new Error("nobody can act but the game is not over");
    const legal = actor.view.me.legal;
    const action = legal[Math.floor(rand() * legal.length)];
    if (!action) throw new Error("no legal action");
    const seq = actor.view.seq;
    const errors = actor.messages.filter((m) => m.t === "error").length;
    actor.send({ t: "action", turn: actor.turn, action });
    await actor.until(
      (c) => (c.view?.seq ?? 0) > seq || c.messages.filter((m) => m.t === "error").length > errors,
      "action result",
    );
    if ((actor.view.seq ?? 0) <= seq) throw new Error(`action refused: ${actor.lastError()}`);
    const now = actor.view.seq;
    for (const client of clients) await client.until((c) => (c.view?.seq ?? 0) >= now, "sync");
  }
  throw new Error("game did not end");
}

async function startedGame(count = 5, settings?: { timers: "fast" }) {
  const code = await createRoom(settings ? { settings } : {});
  const clients = await connectAll(code, count);
  const host = clients[0] as Client;
  host.send({ t: "start" });
  for (const client of clients) await client.until((c) => c.view !== null, "game start");
  return { code, clients, host, stub: roomStub(code) };
}

function outboxSize(stub: DurableObjectStub<GameRoom>): Promise<number> {
  return runInDurableObject(stub, (_instance, state) => {
    return state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n;
  });
}

describe("a private game over WebSockets", () => {
  it("runs from lobby chat to the end of the game", async () => {
    const code = await createRoom();
    const clients = await connectAll(code, 5);
    const [host, second] = clients as [Client, Client];
    await host.until((c) => c.room?.players.length === 5, "5 players seated");
    expect(host.room?.hostPid).toBe(host.pid);

    second.send({ t: "chat", text: "  hello   table " });
    for (const client of clients) {
      await client.until(
        (c) => c.messages.some((m) => m.t === "chat" && m.message.kind === "player"),
        "chat",
      );
    }
    const chat = host.messages.find((m) => m.t === "chat" && m.message.kind === "player");
    expect(chat?.t === "chat" && chat.message.kind === "player" && chat.message.text).toBe(
      "hello table",
    );

    host.send({ t: "start" });
    for (const client of clients) await client.until((c) => c.view !== null, "game start");
    const seats = clients.map((c) => c.view?.me?.seat).sort();
    expect(seats).toEqual([0, 1, 2, 3, 4]);
    // Nobody but the player knows their role before the end.
    expect(clients.every((c) => c.view?.roles === null)).toBe(true);

    await playOverSockets(clients);
    for (const client of clients) {
      await client.until((c) => c.room?.status === "ended", "ended");
      expect(client.view?.roles).toHaveLength(5);
    }
    expect(host.room?.result?.kind).toBe("finished");
    expect(await outboxSize(roomStub(code))).toBe(1);
  });

  it("answers bad messages with errors, and floods with a close", async () => {
    const { clients } = await startedGame();
    const [client] = clients as [Client];
    client.send("{not json");
    await client.until((c) => c.lastError() === "invalid_message", "invalid_message");
    client.send({ t: "kick", pid: "nobody" });
    await client.until(
      (c) => c.lastError() === "not_host" || c.lastError() === "unknown_member",
      "kick error",
    );

    const welcomes = client.messages.filter((m) => m.t === "welcome").length;
    client.send({ t: "sync" });
    await client.until(
      (c) => c.messages.filter((m) => m.t === "welcome").length > welcomes,
      "sync",
    );

    client.send("ping");
    await client.until((c) => c.raw.includes("pong"), "pong");

    for (let i = 0; i < 20; i++) client.send("garbage");
    expect(await client.closeCode()).toBe(CLOSE.badRequest);
  });

  it("refuses actions from spectators", async () => {
    const { code, clients } = await startedGame();
    const spectator = await Client.connect(code, guestId(9));
    await spectator.welcomed();
    expect(spectator.view?.me).toBeNull();
    const action = clients.find((c) => (c.view?.me?.legal.length ?? 0) > 0)?.view?.me?.legal[0];
    if (!action) throw new Error("no legal action");
    spectator.send({ t: "action", turn: spectator.turn, action });
    await spectator.until((c) => c.lastError() === "not_a_player", "not_a_player");
  });

  it("closes a kicked player's socket and refuses them afterwards", async () => {
    const code = await createRoom();
    const [host, target] = (await connectAll(code, 2)) as [Client, Client];
    host.send({ t: "kick", pid: target.pid });
    expect(await target.closeCode()).toBe(CLOSE.kicked);
    const again = await Client.connect(code, guestId(2));
    expect(await again.closeCode()).toBe(CLOSE.kicked);
  });

  it("gives a reconnecting player their seat back", async () => {
    const { code, clients } = await startedGame();
    const [, player] = clients as [Client, Client];
    const seat = player.view?.me?.seat;
    player.close();
    await player.closeCode();
    const back = await Client.connect(code, guestId(2));
    await back.welcomed();
    expect(back.pid).toBe(player.pid);
    expect(back.view?.me?.seat).toBe(seat);
  });
});

describe("restarts", () => {
  it("carries on after the room is evicted with hibernated sockets", async () => {
    const { clients, stub } = await startedGame();
    await evictDurableObject(stub);
    await playOverSockets(clients, 5);
    expect(clients[0]?.room?.status).toBe("ended");
  });

  it("lets everyone reconnect after an eviction that drops the sockets", async () => {
    const { code, clients, stub } = await startedGame();
    const seats = clients.map((c) => c.view?.me?.seat);
    await evictDurableObject(stub, { webSockets: "close" });
    for (const client of clients) await client.closeCode();
    const back = await connectAll(code, 5);
    expect(back.map((c) => c.view?.me?.seat)).toEqual(seats);
    await playOverSockets(back, 9);
    expect(back[0]?.room?.status).toBe("ended");
  });
});

describe("alarm", () => {
  it("plays the default action when a turn times out", async () => {
    const { clients, stub } = await startedGame(5, { timers: "fast" });
    const [client] = clients as [Client];
    const deadline = client.room?.game?.deadline;
    expect(deadline).toBeTypeOf("number");
    vi.spyOn(Date, "now").mockReturnValue((deadline as number) + 1);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    for (const c of clients) await c.until((x) => x.view?.phase.kind === "vote", "auto nomination");
  });

  it("delivers the result to the website, retrying until it is accepted", async () => {
    const { host, stub } = await startedGame();
    // Captured inside the mock: a request body made by the room cannot be read from the test.
    const requests: { url: string; signature: string | null; body: string }[] = [];
    const capture = (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        signature: new Headers(init?.headers).get(SIGNATURE_HEADER),
        body: typeof init?.body === "string" ? init.body : "",
      });
    };
    // Mocked before the game ends: the room sets its alarm ~50 ms after the last move, and on
    // a busy machine that alarm can fire on its own before the test gets to run it.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      capture(input, init);
      return Promise.resolve(new Response("busy", { status: 503 }));
    });
    host.send({ t: "endGame" });
    await host.until((c) => c.room?.result?.kind === "abandoned", "abandoned");
    expect(await outboxSize(stub)).toBe(1);

    await runDurableObjectAlarm(stub);
    const games = () => requests.filter((r) => r.url.endsWith("/api/internal/games"));
    expect(games().length).toBeGreaterThanOrEqual(1);
    expect(await outboxSize(stub)).toBe(1);

    fetchSpy.mockImplementation((input, init) => {
      capture(input, init);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await outboxSize(stub)).toBe(0);

    const delivered = games().at(-1);
    expect(delivered?.url).toBe("https://web.test/api/internal/games");
    const body = delivered?.body ?? "";
    const ok = await verifyRequest(
      env.ROOMS_TO_WEB_SECRET,
      { method: "POST", path: "/api/internal/games", body },
      delivered?.signature ?? null,
      Date.now(),
    );
    expect(ok).toBe(true);
    const payload = gameResultPayloadSchema.parse(JSON.parse(body));
    expect(payload.result).toEqual({ kind: "abandoned" });
  });

  it("closes the room 30 minutes after the game", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const { code, host, clients, stub } = await startedGame();
    host.send({ t: "endGame" });
    await host.until((c) => c.room?.status === "ended", "ended");
    await runDurableObjectAlarm(stub);
    expect(await outboxSize(stub)).toBe(0);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + ROOM_TIMING.purgeAfterEndMs + 1000);
    await runDurableObjectAlarm(stub);
    for (const client of clients) expect(await client.closeCode()).toBe(CLOSE.roomClosed);
    expect(await stub.info()).toBeNull();
    const late = await Client.connect(code, guestId(1));
    expect(await late.closeCode()).toBe(CLOSE.roomNotFound);
  });

  it("lists a public room in the lobby", async () => {
    const code = await createRoom({ visibility: "public", lang: "en", host: userId(1) });
    const host = await Client.connect(code, userId(1));
    await host.welcomed();
    await runDurableObjectAlarm(roomStub(code));
    const rooms = await env.LOBBY.getByName("global").list();
    expect(rooms.find((r) => r.code === code)).toMatchObject({ players: 1, status: "lobby" });
  });
});
