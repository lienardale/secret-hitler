/**
 * POST /api/rooms/:code/ticket → { url }: a WebSocket URL carrying a fresh
 * room ticket (60 s, single use). The room client calls it before every
 * (re)connection attempt.
 *
 * A signed-in, onboarded account gets an account ticket (with the players it
 * blocked); otherwise the guest cookie is used. 401 { error: "no_guest" } when
 * there is neither (the page then asks for a guest name). Public rooms refuse
 * guests themselves (close 4403); the room page asks for an account first.
 *
 * A suspended account (an active ban) gets 403 { error: "banned" }: the room
 * client shows the same notice as a socket closed with 4451. Guests are never
 * refused for a ban (bans apply to accounts only). Every account ticket
 * records the visit (`RoomVisit`), so a later ban or forced rename reaches the
 * rooms the account is in.
 *
 * The abandon cooldown (lib/games/cooldown.ts) applies here as well as in
 * quick match: an account in cooldown cannot take a seat in a public room's
 * lobby, even from the lobby list or a link. Rooms already playing or ended
 * are not refused (the account can only watch them, or is coming back to its
 * own seat). Only accounts in cooldown pay the extra call to the Worker.
 *
 *   200 { url }                   the WebSocket URL
 *   401 { error: "no_guest" }     neither an onboarded account nor a guest cookie
 *   403 { error: "forbidden" }    cross-origin request
 *   403 { error: "banned" }       the account is suspended
 *   403 { error: "cooldown", until }  the account left 2 public games within 24 h and the room is
 *                                 a public lobby: it may join one again at `until` (ms since epoch)
 *   404 { error: "not_found" }    not a room code
 *   429 { error: "rate_limited" } 60 tickets per minute per identity (retry-after)
 */
import "server-only";

import { isRoomCode } from "@sh/protocol";

import { getCurrentUser, isOnboarded } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { quickMatchCooldownUntil } from "@/lib/games/cooldown";
import { readGuest } from "@/lib/guest/session";
import { activeBan } from "@/lib/moderation/bans";
import { recordVisit } from "@/lib/moderation/visits";
import { blockedKeys } from "@/lib/players/blocks";
import { roomInfo } from "@/lib/rooms/api";
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

/** A public room still in its lobby. If the Worker cannot say, no: the socket would fail anyway. */
async function isPublicLobby(code: string): Promise<boolean> {
  try {
    const info = await roomInfo(code);
    return info?.visibility === "public" && info.status === "lobby";
  } catch {
    return false;
  }
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
    const [ban, blocks, cooldown] = await Promise.all([
      activeBan(prisma, user.id),
      blockedKeys(prisma, user.id),
      quickMatchCooldownUntil(user.id),
    ]);
    if (ban) return Response.json({ error: "banned" }, { status: 403, headers: noStore });
    if (cooldown && (await isPublicLobby(code))) {
      return Response.json(
        { error: "cooldown", until: cooldown.getTime() },
        { status: 403, headers: noStore },
      );
    }
    await recordVisit(prisma, user.id, code);
    const url = await userTicketUrl(
      { id: user.id, displayName: user.displayName, moderator: user.role !== "USER" },
      blocks,
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
