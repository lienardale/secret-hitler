import { afterEach, describe, expect, it, vi } from "vitest";

import { connectRoom } from "../../lib/room-client/connection";
import type { RoomClientEvent } from "../../lib/room-client/state";

/** Minimal browser-like WebSocket the tests drive by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType = "blob";
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.emit("close", { type: "close", code, reason, wasClean: true });
  }
  open() {
    this.readyState = 1;
    this.emit("open", { type: "open" });
  }
  message(data: string) {
    this.emit("message", { type: "message", data });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.emit("close", { type: "close", code, reason: "", wasClean: true });
  }
  /** What a browser does when the connection breaks: `error`, then an abnormal close. */
  fail() {
    this.readyState = 3;
    this.emit("error", { type: "error" });
    this.emit("close", { type: "close", code: 1006, reason: "", wasClean: false });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  FakeSocket.instances = [];
  vi.useRealTimers();
});

function connect(fetchTicketUrl = vi.fn(async () => "ws://rooms.test/v1/rooms/BCDFG/ws?t=x")) {
  const events: RoomClientEvent[] = [];
  const connection = connectRoom({
    code: "BCDFG",
    dispatch: (event) => events.push(event),
    fetchTicketUrl,
    WebSocket: FakeSocket as unknown as typeof WebSocket,
  });
  return { events, connection, fetchTicketUrl };
}

describe("room connection", () => {
  it("connects with a fresh ticket and forwards messages", async () => {
    const { events, connection, fetchTicketUrl } = connect();
    await flush();
    expect(fetchTicketUrl).toHaveBeenCalledWith("BCDFG");
    const socket = FakeSocket.instances[0] as FakeSocket;
    expect(socket.url).toContain("t=x");
    socket.open();
    socket.message(
      JSON.stringify({
        t: "chat",
        message: { kind: "system", id: 1, at: 1, key: "gameStarted", params: {} },
      }),
    );
    socket.message("pong");
    socket.message("not json");
    expect(events.map((e) => e.type)).toEqual(["open", "message"]);
    expect(connection.send({ t: "sync" })).toBe(true);
    expect(socket.sent).toEqual(['{"t":"sync"}']);
    connection.close();
  });

  it("refuses to send while not connected (nothing is queued)", async () => {
    const { connection } = connect();
    await flush();
    expect(connection.send({ t: "sync" })).toBe(false);
    connection.close();
  });

  it("reports a retryable drop as lost, and a kick as closed for good", async () => {
    const { events, connection } = connect();
    await flush();
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.open();
    socket.serverClose(1006);
    expect(events.at(-1)).toEqual({ type: "lost" });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const second = FakeSocket.instances[1] as FakeSocket;
    expect(second).toBeDefined();
    second.open();
    second.serverClose(4423);
    expect(events.at(-1)).toEqual({ type: "closed", code: 4423 });
    connection.close();
  });

  it("stops and asks for a name when the ticket route answers 401", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ error: "no_guest" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const events: RoomClientEvent[] = [];
    const connection = connectRoom({
      code: "BCDFG",
      dispatch: (event) => events.push(event),
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/rooms/BCDFG/ticket",
      expect.objectContaining({ method: "POST" }),
    );
    expect(events).toEqual([{ type: "needsName" }]);
    expect(FakeSocket.instances).toHaveLength(0);
    connection.close();
    vi.unstubAllGlobals();
  });

  it("reports a suspended account (ticket 403 banned) as closed 4451 without retrying", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ error: "banned" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const events: RoomClientEvent[] = [];
    const connection = connectRoom({
      code: "BCDFG",
      dispatch: (event) => events.push(event),
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "closed", code: 4451 }]);
    expect(FakeSocket.instances).toHaveLength(0);
    connection.close();
    vi.unstubAllGlobals();
  });

  it("maps the abandon cooldown (ticket 403 cooldown) to a cooldown notice without retrying", async () => {
    const until = Date.parse("2026-11-02T12:15:00Z");
    for (const [body, expected] of [
      [{ error: "cooldown", until }, until],
      [{ error: "cooldown" }, null],
    ] as const) {
      const fetchSpy = vi.fn(async () => new Response(JSON.stringify(body), { status: 403 }));
      vi.stubGlobal("fetch", fetchSpy);
      const events: RoomClientEvent[] = [];
      const connection = connectRoom({
        code: "BCDFG",
        dispatch: (event) => events.push(event),
        WebSocket: FakeSocket as unknown as typeof WebSocket,
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(events).toEqual([{ type: "cooldown", until: expected }]);
      connection.close();
      vi.unstubAllGlobals();
    }
    expect(FakeSocket.instances).toHaveLength(0);
  }, 10_000);

  it("retries a 403 that is neither a ban nor a cooldown", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const events: RoomClientEvent[] = [];
    const connection = connectRoom({
      code: "BCDFG",
      dispatch: (event) => events.push(event),
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    expect(events).toEqual([]);
    connection.close();
    vi.unstubAllGlobals();
  });

  it("ends the session when the room closes a live socket with 4451 (banned)", async () => {
    const { events, connection, fetchTicketUrl } = connect();
    await flush();
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.open();
    socket.serverClose(4451);
    expect(events.at(-1)).toEqual({ type: "closed", code: 4451 });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(FakeSocket.instances).toHaveLength(1);
    expect(fetchTicketUrl).toHaveBeenCalledTimes(1);
    connection.close();
  });

  it("retries after a socket error (partysocket reports it as a close 1000)", async () => {
    const { events, connection, fetchTicketUrl } = connect();
    await flush();
    const first = FakeSocket.instances[0] as FakeSocket;
    first.open();
    first.fail();
    expect(events.at(-1)).toEqual({ type: "lost" });
    expect(events.some((event) => event.type === "closed")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(fetchTicketUrl).toHaveBeenCalledTimes(2);
    const second = FakeSocket.instances[1] as FakeSocket;
    expect(second).toBeDefined();
    second.open();
    expect(events.at(-1)).toEqual({ type: "open" });
    connection.close();
  });

  it("retries when fetching a ticket fails after a drop", async () => {
    let calls = 0;
    const fetchTicketUrl = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error("ticket 500");
      return `ws://rooms.test/v1/rooms/BCDFG/ws?t=${calls}`;
    });
    const { events, connection } = connect(fetchTicketUrl);
    await flush();
    (FakeSocket.instances[0] as FakeSocket).open();
    (FakeSocket.instances[0] as FakeSocket).serverClose(1006);
    await new Promise((resolve) => setTimeout(resolve, 4500));
    expect(fetchTicketUrl).toHaveBeenCalledTimes(3);
    expect(events.some((event) => event.type === "closed")).toBe(false);
    const next = FakeSocket.instances.at(-1) as FakeSocket;
    expect(next.url).toContain("t=3");
    connection.close();
  });

  it("reconnect() drops the socket and connects again with a fresh ticket, silently", async () => {
    let calls = 0;
    const fetchTicketUrl = vi.fn(async () => {
      calls += 1;
      return `ws://rooms.test/v1/rooms/BCDFG/ws?t=${calls}`;
    });
    const { events, connection } = connect(fetchTicketUrl);
    await flush();
    const first = FakeSocket.instances[0] as FakeSocket;
    first.open();
    connection.reconnect();
    expect(first.readyState).toBe(3);
    await flush();
    await flush();
    expect(fetchTicketUrl).toHaveBeenCalledTimes(2);
    const second = FakeSocket.instances[1] as FakeSocket;
    expect(second.url).toContain("t=2");
    second.open();
    expect(events.map((event) => event.type)).toEqual(["open", "open"]);
    expect(connection.send({ t: "sync" })).toBe(true);
    // Still a live session: a kick afterwards ends it as usual.
    second.serverClose(4423);
    expect(events.at(-1)).toEqual({ type: "closed", code: 4423 });
    connection.reconnect();
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    connection.close();
  });

  it("reports a missing room as closed (4404) without retrying", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    const events: RoomClientEvent[] = [];
    const connection = connectRoom({
      code: "BCDFG",
      dispatch: (event) => events.push(event),
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "closed", code: 4404 }]);
    connection.close();
    vi.unstubAllGlobals();
  });
});
