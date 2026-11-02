/**
 * Helpers for tests that go through the real Worker and Durable Objects:
 * tickets, signed internal calls, and a small WebSocket client.
 */
import type { PlayerView } from "@sh/engine";
import {
  PROTOCOL_VERSION,
  SIGNATURE_HEADER,
  importTicketPrivateKey,
  serverMessageSchema,
  signRequest,
  signTicket,
  type ClientMessage,
  type CreateRoomRequest,
  type RoomView,
  type ServerMessage,
  type TicketClaims,
} from "@sh/protocol";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";

export const ORIGIN = "http://localhost:3000";
const BASE = "https://rooms.test";

let keyPromise: ReturnType<typeof importTicketPrivateKey> | null = null;
function testKey() {
  keyPromise ??= importTicketPrivateKey(env.TEST_TICKET_PRIVATE_JWK);
  return keyPromise;
}

export interface TestIdentity {
  kind: "guest" | "user";
  sub: string;
  name: string;
}

export const guestId = (n: number): TestIdentity => ({
  kind: "guest",
  sub: `g${n}`,
  name: `Player ${n}`,
});
export const userId = (n: number): TestIdentity => ({
  kind: "user",
  sub: `u${n}`,
  name: `User ${n}`,
});

export async function ticket(
  room: string,
  identity: TestIdentity,
  extra: Partial<TicketClaims> = {},
  options: Parameters<typeof signTicket>[2] & { key?: Awaited<ReturnType<typeof testKey>> } = {},
): Promise<string> {
  const claims: TicketClaims = {
    ...identity,
    room,
    blocks: [],
    mod: false,
    pv: PROTOCOL_VERSION,
    ...extra,
  };
  return signTicket(claims, options.key ?? (await testKey()), options);
}

export async function signedFetch(
  method: "GET" | "POST",
  path: string,
  body = "",
  options: { secret?: string; now?: number; sendBody?: string } = {},
): Promise<Response> {
  const signature = await signRequest(
    options.secret ?? env.WEB_TO_ROOMS_SECRET,
    { method, path, body },
    options.now,
  );
  return exports.default.fetch(`${BASE}${path}`, {
    method,
    body: method === "GET" ? undefined : (options.sendBody ?? body),
    headers: { [SIGNATURE_HEADER]: signature, "content-type": "application/json" },
  });
}

export async function createRoom(overrides: Partial<CreateRoomRequest> = {}): Promise<string> {
  const request: CreateRoomRequest = {
    visibility: "private",
    lang: "fr",
    host: guestId(1),
    ...overrides,
  };
  const response = await signedFetch("POST", "/internal/rooms", JSON.stringify(request));
  if (response.status !== 201) throw new Error(`create failed: ${response.status}`);
  return (await response.json<{ code: string }>()).code;
}

export function roomStub(code: string) {
  return env.GAME_ROOM.getByName(code);
}

/** Opens a raw WebSocket through the Worker. */
export async function openSocket(
  path: string,
  headers: Record<string, string> = { Origin: ORIGIN },
): Promise<{ response: Response; ws: WebSocket | null }> {
  const response = await exports.default.fetch(`${BASE}${path}`, {
    headers: { Upgrade: "websocket", ...headers },
  });
  const ws = response.webSocket;
  ws?.accept();
  return { response, ws };
}

/** A test client that records messages and tracks the latest room and game state. */
export class Client {
  readonly messages: ServerMessage[] = [];
  readonly raw: string[] = [];
  closed: { code: number; reason: string } | null = null;
  pid = "";
  room: RoomView | null = null;
  view: PlayerView | null = null;
  turn = 0;
  private waiters = new Set<() => void>();

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      this.raw.push(data);
      if (data !== "pong") this.record(serverMessageSchema.parse(JSON.parse(data)));
      this.wake();
    });
    ws.addEventListener("close", (event) => {
      this.closed = { code: event.code, reason: event.reason };
      this.wake();
    });
  }

  private record(message: ServerMessage): void {
    this.messages.push(message);
    switch (message.t) {
      case "welcome":
        this.pid = message.you.pid;
        this.room = message.room;
        this.view = message.game?.view ?? null;
        this.turn = message.game?.turn ?? message.room.game?.turn ?? 0;
        break;
      case "room":
        this.room = message.room;
        if (message.room.game) this.turn = message.room.game.turn;
        break;
      case "game":
        this.view = message.view;
        this.turn = message.turn;
        break;
      default:
        break;
    }
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  static async connect(code: string, identity: TestIdentity, extra: Partial<TicketClaims> = {}) {
    const token = await ticket(code, identity, extra);
    return Client.connectWith(code, token);
  }

  static async connectWith(code: string, token: string): Promise<Client> {
    const { ws, response } = await openSocket(
      `/v1/rooms/${code}/ws?t=${encodeURIComponent(token)}`,
    );
    if (!ws) throw new Error(`no WebSocket (status ${response.status})`);
    return new Client(ws);
  }

  /** Waits until `check` is true (re-checked after every message or close). */
  async until(
    check: (client: Client) => boolean,
    what = "condition",
    timeoutMs = 3000,
  ): Promise<void> {
    const started = performance.now();
    while (!check(this)) {
      if (performance.now() - started > timeoutMs) throw new Error(`timeout waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.add(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  welcomed(): Promise<void> {
    return this.until(
      (c) => c.messages.some((m) => m.t === "welcome") || c.closed !== null,
      "welcome",
    );
  }

  async closeCode(): Promise<number> {
    await this.until((c) => c.closed !== null, "close");
    return this.closed?.code ?? -1;
  }

  send(message: ClientMessage | string): void {
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  lastError(): string | null {
    const errors = this.messages.filter((m) => m.t === "error");
    return errors.at(-1)?.code ?? null;
  }

  close(): void {
    this.ws.close(1000, "bye");
  }
}

/** Connects `count` guests to a room and waits for their welcomes. */
export async function connectAll(code: string, count: number, make = guestId): Promise<Client[]> {
  const clients: Client[] = [];
  for (let i = 1; i <= count; i++) {
    const client = await Client.connect(code, make(i));
    await client.welcomed();
    clients.push(client);
  }
  return clients;
}
