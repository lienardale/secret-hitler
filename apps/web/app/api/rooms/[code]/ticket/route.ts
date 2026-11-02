/**
 * POST /api/rooms/:code/ticket → { url }: a WebSocket URL carrying a fresh
 * room ticket (60 s, single use). The room client calls it before every
 * (re)connection attempt.
 *
 * A signed-in, onboarded account gets an account ticket (with the players it
 * blocked); otherwise the guest cookie is used. 401 { error: "no_guest" } when
 * there is neither (the page then asks for a guest name). Public rooms refuse
 * guests themselves (close 4403); the room page asks for an account first.
 */
import "server-only";

import { isRoomCode } from "@sh/protocol";

import { getCurrentUser, isOnboarded } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { readGuest } from "@/lib/guest/session";
import { blockedKeys } from "@/lib/players/blocks";
import { guestTicketUrl, userTicketUrl } from "@/lib/rooms/ticket";
import { ticketLimit } from "@/lib/security/limits";
import { isSameOrigin } from "@/lib/security/origin";

const noStore = { "cache-control": "no-store" };

function rateLimited(retryAfterMs: number): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { ...noStore, "retry-after": String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

export async function POST(request: Request, ctx: RouteContext<"/api/rooms/[code]/ticket">) {
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  }
  const { code } = await ctx.params;
  if (!isRoomCode(code)) {
    return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
  }

  const user = await getCurrentUser();
  if (isOnboarded(user)) {
    const limited = ticketLimit.take(`u:${user.id}`);
    if (!limited.ok) return rateLimited(limited.retryAfterMs);
    const url = await userTicketUrl(
      { id: user.id, displayName: user.displayName, moderator: user.role !== "USER" },
      await blockedKeys(prisma, user.id),
      code,
      getEnv(),
    );
    return Response.json({ url }, { headers: noStore });
  }

  const guest = await readGuest();
  if (!guest) return Response.json({ error: "no_guest" }, { status: 401, headers: noStore });
  const limited = ticketLimit.take(`g:${guest.gid}`);
  if (!limited.ok) return rateLimited(limited.retryAfterMs);
  const url = await guestTicketUrl(guest, code, getEnv());
  return Response.json({ url }, { headers: noStore });
}
