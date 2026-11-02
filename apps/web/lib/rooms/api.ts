/**
 * Signed calls from the website's server to the rooms Worker
 * (HMAC, WEB_TO_ROOMS_SECRET; see docs/protocol.md § Server to server).
 */
import {
  SIGNATURE_HEADER,
  createRoomResponseSchema,
  quickMatchResponseSchema,
  roomInfoSchema,
  signRequest,
  type CreateRoomRequest,
  type QuickMatchRequest,
  type RoomInfo,
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
