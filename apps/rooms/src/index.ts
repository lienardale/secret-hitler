/**
 * Rooms Worker: routes requests to the room Durable Objects and the lobby.
 *
 *   GET  /health
 *   GET  /v1/rooms/:code/ws?t=<ticket>   WebSocket into a room (Origin + ticket checked here)
 *   GET  /v1/lobby/ws                    WebSocket for the public room list (Origin checked)
 *   POST /internal/rooms                 create a room          ┐
 *   GET  /internal/rooms/:code           a room's public info    │ signed by the website
 *   POST /internal/lobby/quickmatch      pick a public room      │ (HMAC, ±5 min)
 *   GET  /internal/lobby                 list public rooms       ┘
 */
import {
  CLOSE,
  PROTOCOL_VERSION,
  createRoomRequestSchema,
  generateRoomCode,
  isRoomCode,
  isSupportedProtocol,
  quickMatchRequestSchema,
} from "@sh/protocol";

import { checkTicket, originAllowed, readSignedRequest } from "./auth";
import { LOBBY_NAME } from "./lobby/Lobby";
import { TICKET_HEADER } from "./room/GameRoom";

export { GameRoom } from "./room/GameRoom";
export { Lobby } from "./lobby/Lobby";

const ROOM_WS = /^\/v1\/rooms\/([^/]+)\/ws$/;
const ROOM_INFO = /^\/internal\/rooms\/([^/]+)$/;
const CREATE_ATTEMPTS = 8;

/** Accepts the WebSocket only to close it with a code the client can read. */
function closeWith(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

async function roomSocket(request: Request, env: Env, code: string): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  if (!originAllowed(request, env)) return new Response("Forbidden origin", { status: 403 });
  if (!isRoomCode(code)) return closeWith(CLOSE.roomNotFound, "invalid room code");
  const token = new URL(request.url).searchParams.get("t");
  if (!token) return closeWith(CLOSE.unauthorized, "missing ticket");
  const checked = await checkTicket(token, code, env);
  if (!checked.ok) return closeWith(CLOSE.unauthorized, `ticket ${checked.reason}`);
  if (!isSupportedProtocol(checked.ticket.pv)) {
    return closeWith(CLOSE.protocolMismatch, "please reload the page");
  }
  const headers = new Headers(request.headers);
  headers.set(TICKET_HEADER, JSON.stringify(checked.ticket));
  return env.GAME_ROOM.getByName(code).fetch(new Request(request, { headers }));
}

async function createRoom(body: string, env: Env): Promise<Response> {
  const parsed = createRoomRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  if (parsed.data.visibility === "public" && parsed.data.host.kind === "guest") {
    return Response.json({ error: "public rooms need an account" }, { status: 400 });
  }
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    if (await env.GAME_ROOM.getByName(code).create(parsed.data)) {
      return Response.json({ code }, { status: 201 });
    }
  }
  return Response.json({ error: "no free room code" }, { status: 503 });
}

async function internal(request: Request, env: Env, path: string): Promise<Response> {
  const body = await readSignedRequest(request, env);
  if (body === null) return new Response("Unauthorized", { status: 401 });
  try {
    if (request.method === "POST" && path === "/internal/rooms") return await createRoom(body, env);
    if (request.method === "POST" && path === "/internal/lobby/quickmatch") {
      const parsed = quickMatchRequestSchema.safeParse(JSON.parse(body));
      if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
      return Response.json(await env.LOBBY.getByName(LOBBY_NAME).quickMatch(parsed.data));
    }
    if (request.method === "GET" && path === "/internal/lobby") {
      return Response.json(await env.LOBBY.getByName(LOBBY_NAME).list());
    }
    const info = ROOM_INFO.exec(path);
    if (request.method === "GET" && info) {
      const code = info[1] as string;
      const room = isRoomCode(code) ? await env.GAME_ROOM.getByName(code).info() : null;
      return room ? Response.json(room) : Response.json({ error: "no such room" }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    throw error;
  }
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
    }
    const room = ROOM_WS.exec(path);
    if (request.method === "GET" && room) return roomSocket(request, env, room[1] as string);
    if (request.method === "GET" && path === "/v1/lobby/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      if (!originAllowed(request, env)) return new Response("Forbidden origin", { status: 403 });
      return env.LOBBY.getByName(LOBBY_NAME).fetch(request);
    }
    if (path.startsWith("/internal/")) return internal(request, env, path);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
