/**
 * Room tickets: a 60 s, single-use Ed25519 JWT for one room, and the
 * WebSocket URL that carries it. The private key never leaves the server.
 * Accounts carry the identity keys they blocked (the room hides those
 * players' chat from them); guests block nobody.
 */
import {
  PROTOCOL_VERSION,
  importTicketPrivateKey,
  signTicket,
  type TicketClaims,
} from "@sh/protocol";

import type { Env } from "../env";
import type { Guest } from "../guest/cookie";

let cached: { jwk: string; key: ReturnType<typeof importTicketPrivateKey> } | null = null;

function privateKey(jwk: string) {
  if (cached?.jwk !== jwk) cached = { jwk, key: importTicketPrivateKey(jwk) };
  return cached.key;
}

/** `https://rooms.example` → `wss://rooms.example/v1/rooms/CODE/ws?t=…` */
export function roomSocketUrl(publicBase: string, code: string, ticket: string): string {
  const url = new URL(`/v1/rooms/${code}/ws`, publicBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("t", ticket);
  return url.toString();
}

type TicketEnv = Pick<Env, "TICKET_PRIVATE_JWK" | "ROOMS_PUBLIC_URL">;

async function ticketUrl(claims: TicketClaims, env: TicketEnv): Promise<string> {
  const ticket = await signTicket(claims, await privateKey(env.TICKET_PRIVATE_JWK));
  return roomSocketUrl(env.ROOMS_PUBLIC_URL, claims.room, ticket);
}

export async function guestTicketUrl(guest: Guest, code: string, env: TicketEnv): Promise<string> {
  return ticketUrl(
    {
      kind: "guest",
      sub: guest.gid,
      name: guest.name,
      room: code,
      blocks: [],
      mod: false,
      pv: PROTOCOL_VERSION,
    },
    env,
  );
}

/** The account's ticket: `blocks` are identity keys (`u:<id>`), at most 500. */
export async function userTicketUrl(
  user: { id: string; displayName: string; moderator: boolean },
  blocks: readonly string[],
  code: string,
  env: TicketEnv,
): Promise<string> {
  return ticketUrl(
    {
      kind: "user",
      sub: user.id,
      name: user.displayName,
      room: code,
      blocks: blocks.slice(0, 500),
      mod: user.moderator,
      pv: PROTOCOL_VERSION,
    },
    env,
  );
}
