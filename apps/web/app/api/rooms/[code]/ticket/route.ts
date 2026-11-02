/**
 * POST /api/rooms/:code/ticket → { url }: a WebSocket URL carrying a fresh
 * room ticket (60 s, single use). The room client calls it before every
 * (re)connection attempt.
 *
 * 401 { error: "no_guest" } when there is no valid guest cookie (the page
 * then asks for a name); accounts join in M4.
 */
import "server-only";

import { isRoomCode } from "@sh/protocol";

import { getEnv } from "@/lib/env";
import { readGuest } from "@/lib/guest/session";
import { guestTicketUrl } from "@/lib/rooms/ticket";
import { ticketLimit } from "@/lib/security/limits";
import { isSameOrigin } from "@/lib/security/origin";

const noStore = { "cache-control": "no-store" };

export async function POST(request: Request, ctx: RouteContext<"/api/rooms/[code]/ticket">) {
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  }
  const { code } = await ctx.params;
  if (!isRoomCode(code)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
  }
  const guest = await readGuest();
  if (!guest) return Response.json({ error: "no_guest" }, { status: 401, headers: noStore });
  const limited = ticketLimit.take(guest.gid);
  if (!limited.ok) {
    return Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { ...noStore, "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) },
      },
    );
  }
  const url = await guestTicketUrl(guest, code, getEnv());
  return Response.json({ url }, { headers: noStore });
}
