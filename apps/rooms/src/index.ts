/**
 * Rooms Worker: routes requests to the room Durable Objects and the lobby.
 *
 *   GET  /health
 *   GET  /v1/rooms/:code/ws?t=<ticket>   WebSocket into a room (Origin + ticket checked here)
 *   GET  /v1/lobby/ws                    WebSocket for the public room list (Origin checked)
 *   POST /internal/rooms                 create a room              ┐
 *   GET  /internal/rooms/:code           a room's public info        │
 *   POST /internal/rooms/:code/report    a player reports a member   │ signed by the website
 *   POST /internal/rooms/:code/member    who is behind a pid         │ (HMAC, ±5 min)
 *   POST /internal/moderation            ban / rename in live rooms  │
 *   POST /internal/lobby/quickmatch      pick a public room          │
 *   GET  /internal/lobby                 list public rooms           ┘
 */
import {
  CLOSE,
  PROTOCOL_VERSION,
  createRoomRequestSchema,
  generateRoomCode,
  isRoomCode,
  isSupportedProtocol,
  moderationRequestSchema,
  quickMatchRequestSchema,
  roomMemberRequestSchema,
  roomReportRequestSchema,
  type ModerationResponse,
} from "@sh/protocol";

import { checkTicket, originAllowed, readSignedRequest } from "./auth";
import { LOBBY_NAME } from "./lobby/Lobby";
import { TICKET_HEADER } from "./room/GameRoom";
import { PLACEMENT } from "./placement";

export { GameRoom } from "./room/GameRoom";
export { Lobby } from "./lobby/Lobby";

const ROOM_WS = /^\/v1\/rooms\/([^/]+)\/ws$/;
const ROOM_INFO = /^\/internal\/rooms\/([^/]+)$/;
const ROOM_REPORT = /^\/internal\/rooms\/([^/]+)\/report$/;
const ROOM_MEMBER = /^\/internal\/rooms\/([^/]+)\/member$/;
const CREATE_ATTEMPTS = 8;
/** Rooms a moderation request may touch (the website's list plus the lobby's). */
const MODERATION_MAX_ROOMS = 100;

const invalid = (): Response => Response.json({ error: "invalid request" }, { status: 400 });
const noRoom = (): Response => Response.json({ error: "no_room" }, { status: 404 });

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
  return env.GAME_ROOM.getByName(code, PLACEMENT).fetch(new Request(request, { headers }));
}

async function createRoom(body: string, env: Env): Promise<Response> {
  const parsed = createRoomRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  if (parsed.data.visibility === "public" && parsed.data.host.kind === "guest") {
    return Response.json({ error: "public rooms need an account" }, { status: 400 });
  }
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    if (await env.GAME_ROOM.getByName(code, PLACEMENT).create(parsed.data)) {
      return Response.json({ code }, { status: 201 });
    }
  }
  return Response.json({ error: "no free room code" }, { status: 503 });
}

/** 202 once queued (the room's alarm delivers it), 404 no_room, 422 with a RoomReportError. */
async function reportToRoom(body: string, env: Env, code: string): Promise<Response> {
  const parsed = roomReportRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return invalid();
  if (!isRoomCode(code)) return noRoom();
  const outcome = await env.GAME_ROOM.getByName(code, PLACEMENT).report(parsed.data);
  if (outcome.ok) return Response.json({ ok: true }, { status: 202 });
  if (outcome.error === "no_room") return noRoom();
  return Response.json({ error: outcome.error }, { status: 422 });
}

/** 200 RoomMember, 404 no_room / unknown_target, 422 not_member. */
async function roomMember(body: string, env: Env, code: string): Promise<Response> {
  const parsed = roomMemberRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return invalid();
  if (!isRoomCode(code)) return noRoom();
  const outcome = await env.GAME_ROOM.getByName(code, PLACEMENT).member(parsed.data);
  if (outcome.ok) return Response.json(outcome.member);
  const status = outcome.error === "not_member" ? 422 : 404;
  return Response.json({ error: outcome.error }, { status });
}

/**
 * Applies a ban or rename to the rooms the website lists plus the public rooms
 * the lobby knows the account is in. A room that is gone or fails just does
 * not count; 200 `{ applied }` lists the rooms where the account was a member.
 */
async function moderate(body: string, env: Env): Promise<Response> {
  const parsed = moderationRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return invalid();
  const { identity, rooms, action } = parsed.data;
  let listed: string[] = [];
  try {
    listed = await env.LOBBY.getByName(LOBBY_NAME, PLACEMENT).roomsWith(identity);
  } catch (error) {
    // Best effort: the website's own list still gets the action.
    console.error("moderation: lobby lookup failed", error);
  }
  const codes = [...new Set([...rooms, ...listed])].slice(0, MODERATION_MAX_ROOMS);
  const results = await Promise.allSettled(
    codes.map((code) => env.GAME_ROOM.getByName(code, PLACEMENT).moderate(identity, action)),
  );
  const applied = codes.filter((_, i) => {
    const result = results[i];
    return result?.status === "fulfilled" && result.value;
  });
  return Response.json({ applied } satisfies ModerationResponse);
}

async function internal(request: Request, env: Env, path: string): Promise<Response> {
  const body = await readSignedRequest(request, env);
  if (body === null) return new Response("Unauthorized", { status: 401 });
  try {
    if (request.method === "POST" && path === "/internal/rooms") return await createRoom(body, env);
    if (request.method === "POST" && path === "/internal/lobby/quickmatch") {
      const parsed = quickMatchRequestSchema.safeParse(JSON.parse(body));
      if (!parsed.success) return invalid();
      return Response.json(
        await env.LOBBY.getByName(LOBBY_NAME, PLACEMENT).quickMatch(parsed.data),
      );
    }
    if (request.method === "GET" && path === "/internal/lobby") {
      return Response.json(await env.LOBBY.getByName(LOBBY_NAME, PLACEMENT).list());
    }
    if (request.method === "POST" && path === "/internal/moderation") {
      return await moderate(body, env);
    }
    const report = ROOM_REPORT.exec(path);
    if (request.method === "POST" && report) {
      return await reportToRoom(body, env, report[1] as string);
    }
    const member = ROOM_MEMBER.exec(path);
    if (request.method === "POST" && member) {
      return await roomMember(body, env, member[1] as string);
    }
    const info = ROOM_INFO.exec(path);
    if (request.method === "GET" && info) {
      const code = info[1] as string;
      const room = isRoomCode(code) ? await env.GAME_ROOM.getByName(code, PLACEMENT).info() : null;
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
      return env.LOBBY.getByName(LOBBY_NAME, PLACEMENT).fetch(request);
    }
    if (path.startsWith("/internal/")) return internal(request, env, path);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
