/**
 * Signed calls from the website's server to the rooms Worker
 * (HMAC, WEB_TO_ROOMS_SECRET; see docs/protocol.md § Server to server).
 */
import {
  ROOM_REPORT_ERRORS,
  SIGNATURE_HEADER,
  createRoomResponseSchema,
  moderationResponseSchema,
  quickMatchResponseSchema,
  roomInfoSchema,
  roomMemberSchema,
  signRequest,
  type CreateRoomRequest,
  type ModerationRequest,
  type ModerationResponse,
  type QuickMatchRequest,
  type RoomInfo,
  type RoomMember,
  type RoomMemberRequest,
  type RoomReportError,
  type RoomReportRequest,
} from "@sh/protocol";

import { getEnv, type Env } from "../env";

const TIMEOUT_MS = 8_000;

export class RoomsUnavailableError extends Error {
  constructor(detail: string) {
    super(`rooms Worker unavailable: ${detail}`);
    this.name = "RoomsUnavailableError";
  }
}

async function signedFetch(
  env: Pick<Env, "ROOMS_URL" | "WEB_TO_ROOMS_SECRET">,
  method: "GET" | "POST",
  path: string,
  body = "",
): Promise<Response> {
  const signature = await signRequest(env.WEB_TO_ROOMS_SECRET, { method, path, body });
  try {
    return await fetch(new URL(path, env.ROOMS_URL), {
      method,
      body: method === "POST" ? body : undefined,
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new RoomsUnavailableError(error instanceof Error ? error.message : String(error));
  }
}

export async function createRoom(request: CreateRoomRequest, env = getEnv()): Promise<string> {
  const response = await signedFetch(env, "POST", "/internal/rooms", JSON.stringify(request));
  if (response.status !== 201)
    throw new RoomsUnavailableError(`create answered ${response.status}`);
  return createRoomResponseSchema.parse(await response.json()).code;
}

/** A room's public info, or null if no such room exists. */
export async function roomInfo(code: string, env = getEnv()): Promise<RoomInfo | null> {
  const response = await signedFetch(env, "GET", `/internal/rooms/${code}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new RoomsUnavailableError(`info answered ${response.status}`);
  return roomInfoSchema.parse(await response.json());
}

/** The public room quick match picked, or null (the caller then creates one). */
export async function quickMatch(
  request: QuickMatchRequest,
  env = getEnv(),
): Promise<string | null> {
  const response = await signedFetch(
    env,
    "POST",
    "/internal/lobby/quickmatch",
    JSON.stringify(request),
  );
  if (!response.ok) throw new RoomsUnavailableError(`quick match answered ${response.status}`);
  return quickMatchResponseSchema.parse(await response.json()).code;
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * Asks the room to report one of its members. The room checks the reporter
 * and the target, builds the evidence itself and delivers it later from its
 * outbox (`POST /api/internal/reports`).
 */
export async function reportToRoom(
  code: string,
  request: RoomReportRequest,
  env = getEnv(),
): Promise<{ ok: true } | { ok: false; error: RoomReportError | "no_room" }> {
  const response = await signedFetch(
    env,
    "POST",
    `/internal/rooms/${code}/report`,
    JSON.stringify(request),
  );
  if (response.status === 202) return { ok: true };
  if (response.status === 404) return { ok: false, error: "no_room" };
  if (response.status === 422) {
    const error = await errorCode(response);
    if ((ROOM_REPORT_ERRORS as readonly string[]).includes(error ?? "")) {
      return { ok: false, error: error as RoomReportError };
    }
  }
  throw new RoomsUnavailableError(`report answered ${response.status}`);
}

/**
 * Who is behind a room id (for "block this player" in a room). The room only
 * answers a requester who is one of its members.
 */
export async function roomMember(
  code: string,
  request: RoomMemberRequest,
  env = getEnv(),
): Promise<
  | { ok: true; member: RoomMember }
  | { ok: false; error: "no_room" | "unknown_target" | "not_member" }
> {
  const response = await signedFetch(
    env,
    "POST",
    `/internal/rooms/${code}/member`,
    JSON.stringify(request),
  );
  if (response.ok) return { ok: true, member: roomMemberSchema.parse(await response.json()) };
  if (response.status === 404) {
    return {
      ok: false,
      error: (await errorCode(response)) === "no_room" ? "no_room" : "unknown_target",
    };
  }
  if (response.status === 422) return { ok: false, error: "not_member" };
  throw new RoomsUnavailableError(`member answered ${response.status}`);
}

/**
 * Applies a ban (close the account's sockets, refuse it from now on) or a
 * forced rename to the account's live rooms: `rooms` plus the public rooms
 * the lobby knows it is in.
 */
export async function moderatePlayer(
  request: ModerationRequest,
  env = getEnv(),
): Promise<ModerationResponse> {
  const response = await signedFetch(env, "POST", "/internal/moderation", JSON.stringify(request));
  if (!response.ok) throw new RoomsUnavailableError(`moderation answered ${response.status}`);
  return moderationResponseSchema.parse(await response.json());
}
