/**
 * Shared by the dev scripts (bots, dev-ticket). They play the website's part:
 * they read its local secrets (apps/web/.env.local, written by
 * `npm run dev:setup`) to create rooms and mint tickets.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROTOCOL_VERSION,
  SIGNATURE_HEADER,
  createRoomResponseSchema,
  importTicketPrivateKey,
  signRequest,
  signTicket,
  type CreateRoomRequest,
  type IdentityKind,
} from "@sh/protocol";

/** An origin listed in ALLOWED_ORIGINS for `wrangler dev`. */
export const DEV_ORIGIN = "http://localhost:3000";

const WEB_ENV = join(dirname(fileURLToPath(import.meta.url)), "../../web/.env.local");

export interface DevEnv {
  privateJwk: string;
  webToRoomsSecret: string;
  roomsUrl: string;
}

export function loadDevEnv(): DevEnv {
  if (!existsSync(WEB_ENV))
    throw new Error("apps/web/.env.local not found: run `npm run dev:setup` first.");
  const values = new Map<string, string>();
  for (const line of readFileSync(WEB_ENV, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1] as string, (match[2] as string).replace(/^'(.*)'$/, "$1"));
  }
  const privateJwk = values.get("TICKET_PRIVATE_JWK");
  const webToRoomsSecret = values.get("WEB_TO_ROOMS_SECRET");
  if (!privateJwk || !webToRoomsSecret) {
    throw new Error("apps/web/.env.local lacks ticket keys: run `npm run dev:setup`.");
  }
  return {
    privateJwk,
    webToRoomsSecret,
    roomsUrl: values.get("ROOMS_URL") ?? "http://localhost:8787",
  };
}

export interface DevIdentity {
  kind: IdentityKind;
  sub: string;
  name: string;
}

export async function createRoom(
  env: DevEnv,
  baseUrl: string,
  request: CreateRoomRequest,
): Promise<string> {
  const path = "/internal/rooms";
  const body = JSON.stringify(request);
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: await signRequest(env.webToRoomsSecret, { method: "POST", path, body }),
    },
  });
  if (response.status !== 201) {
    throw new Error(`creating the room failed: ${response.status} ${await response.text()}`);
  }
  return createRoomResponseSchema.parse(await response.json()).code;
}

let keyPromise: ReturnType<typeof importTicketPrivateKey> | null = null;

export async function mintTicket(
  env: DevEnv,
  room: string,
  identity: DevIdentity,
): Promise<string> {
  keyPromise ??= importTicketPrivateKey(env.privateJwk);
  return signTicket(
    { ...identity, room, blocks: [], mod: false, pv: PROTOCOL_VERSION },
    await keyPromise,
  );
}

/** `http://host:8787` → `ws://host:8787/v1/rooms/CODE/ws?t=…` */
export function roomSocketUrl(baseUrl: string, room: string, ticket: string): string {
  const url = new URL(`/v1/rooms/${room}/ws`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("t", ticket);
  return url.toString();
}
