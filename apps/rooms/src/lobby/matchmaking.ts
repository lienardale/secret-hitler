/**
 * Quick match: which public room a player should join. Pure (no Workers APIs)
 * so the rules are unit-tested without a Durable Object.
 */
import type { LobbyEntry, LobbyRoomReport, QuickMatchRequest } from "@sh/protocol";

type Ordered = Pick<LobbyEntry, "code" | "players" | "startsAt">;

/**
 * Fullest rooms first (they start soonest), then the earliest start countdown
 * (a running countdown before none), then the code so the order never depends
 * on insertion order. Also orders each status group of the public list.
 */
export function compareRooms(a: Ordered, b: Ordered): number {
  if (a.players !== b.players) return b.players - a.players;
  if (a.startsAt !== b.startsAt) {
    if (a.startsAt === null) return 1;
    if (b.startsAt === null) return -1;
    return a.startsAt - b.startsAt;
  }
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/**
 * The room code to join, or null when no room fits (the website then creates
 * a new public room).
 *
 * A player who is already in a room goes back to it, whatever its state, so a
 * reload or a second tab never seats them twice. If they somehow sit in two
 * rooms, a game in progress wins over a waiting room.
 */
export function pickRoom(
  entries: readonly LobbyRoomReport[],
  request: QuickMatchRequest,
): string | null {
  const own = entries
    .filter((entry) => entry.members.includes(request.identity))
    .sort((a, b) => statusRank(b) - statusRank(a) || compareRooms(a, b));
  if (own[0]) return own[0].code;

  const blocked = new Set(request.blocks);
  const candidates = entries
    .filter(
      (entry) =>
        entry.status === "lobby" &&
        entry.lang === request.lang &&
        entry.players < entry.maxPlayers &&
        !entry.members.some((member) => blocked.has(member)),
    )
    .sort(compareRooms);
  return candidates[0]?.code ?? null;
}

function statusRank(entry: LobbyRoomReport): number {
  return entry.status === "playing" ? 1 : 0;
}
