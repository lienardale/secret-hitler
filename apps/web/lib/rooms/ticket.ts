/**
 * Room tickets for guests: a 60 s, single-use Ed25519 JWT for one room, and
 * the WebSocket URL that carries it. The private key never leaves the server.
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

export async function guestTicketUrl(
  guest: Guest,
  code: string,
  env: Pick<Env, "TICKET_PRIVATE_JWK" | "ROOMS_PUBLIC_URL">,
): Promise<string> {
  const claims: TicketClaims = {
    kind: "guest",
    sub: guest.gid,
    name: guest.name,
    room: code,
    blocks: [],
    mod: false,
    pv: PROTOCOL_VERSION,
  };
  const ticket = await signTicket(claims, await privateKey(env.TICKET_PRIVATE_JWK));
  return roomSocketUrl(env.ROOMS_PUBLIC_URL, code, ticket);
}
