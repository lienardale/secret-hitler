/**
 * Checks done by the Worker before anything reaches a Durable Object:
 * browser Origin, room tickets, and signed website → rooms requests.
 */
import {
  SIGNATURE_HEADER,
  importTicketPublicKey,
  verifyRequest,
  verifyTicket,
  type TicketFailure,
  type VerifiedTicket,
} from "@sh/protocol";

/** Parsed once per isolate. Keyed by the JWK text so a rotated secret is picked up. */
let cachedKey: {
  jwk: string;
  key: Promise<Awaited<ReturnType<typeof importTicketPublicKey>>>;
} | null = null;

function ticketKey(env: Env) {
  if (cachedKey?.jwk !== env.TICKET_PUBLIC_JWK) {
    cachedKey = { jwk: env.TICKET_PUBLIC_JWK, key: importTicketPublicKey(env.TICKET_PUBLIC_JWK) };
  }
  return cachedKey.key;
}

export async function checkTicket(
  token: string,
  room: string,
  env: Env,
): Promise<{ ok: true; ticket: VerifiedTicket } | { ok: false; reason: TicketFailure }> {
  return verifyTicket(token, await ticketKey(env), { room });
}

/** Browsers always send Origin on WebSocket requests; anything else is refused. */
export function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return false;
  return env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .includes(origin);
}

const MAX_INTERNAL_BODY = 64 * 1024;

/** Reads and checks a signed website → rooms request. Returns its body, or null if refused. */
export async function readSignedRequest(request: Request, env: Env): Promise<string | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_INTERNAL_BODY) return null;
  const body = await request.text();
  if (body.length > MAX_INTERNAL_BODY) return null;
  const url = new URL(request.url);
  const ok = await verifyRequest(
    env.WEB_TO_ROOMS_SECRET,
    { method: request.method, path: url.pathname + url.search, body },
    request.headers.get(SIGNATURE_HEADER),
  );
  return ok ? body : null;
}
