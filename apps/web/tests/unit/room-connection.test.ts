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
