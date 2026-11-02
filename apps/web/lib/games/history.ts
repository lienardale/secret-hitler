/**
 * A player's game history (profile page): their games, newest first, with how
 * they played and who else was at the table.
 *
 * Names: an account shows its current display name (renames apply to old
 * games), a guest the name they played under, and a deleted account `null`
 * ("Deleted player"): an account seat without a user is deleted, whatever
 * name is still stored. `userId` is there so the profile can offer to block a
 * player; it is the account id, so only ever show it to the signed-in owner.
 *
 * Returns plain objects: no Prisma type leaves this module.
 */
import { prisma } from "@/lib/db/prisma";
import type { PrismaClient } from "@/lib/generated/prisma/client";

import { isUuid } from "./ids";

export const HISTORY_PAGE_MAX = 100;

export type Role = "liberal" | "fascist" | "hitler";
export type Team = "liberal" | "fascist";

export interface HistoryPlayer {
  seat: number;
  /** Null for a deleted account. */
  name: string | null;
  role: Role;
  won: boolean;
  /** The account, while it exists; null for guests and deleted accounts. */
  userId: string | null;
}

export interface HistoryGame {
  id: string;
  room: string;
  visibility: "private" | "public";
  /** Game number within the room. */
  number: number;
  endedAt: Date;
  outcome: "finished" | "abandoned";
  winner: Team | null;
  reason: string | null;
  /** The user's own seat in that game. */
  you: { seat: number; role: Role; won: boolean; left: boolean; alive: boolean };
  /** Everyone else, by seat. */
  others: HistoryPlayer[];
}

export interface HistoryOptions {
  /** Page size, 1 to 100 (default 20). */
  limit?: number;
  /** Only games that ended strictly before this (the last `endedAt` of the previous page). */
  before?: Date;
}

export type HistoryDb = Pick<PrismaClient, "gamePlayer">;

function clampLimit(limit: number): number {
  return Math.min(HISTORY_PAGE_MAX, Math.max(1, Math.floor(limit)));
}

/** A live account's current display name, a guest's stored name, null once deleted. */
function shownName(player: {
  kind: "user" | "guest";
  userId: string | null;
  name: string | null;
  user: { displayName: string | null } | null;
}): string | null {
  if (player.kind === "guest") return player.name;
  if (player.userId === null) return null;
  return player.user?.displayName ?? player.name;
}

export async function userGameHistory(
  userId: string,
  { limit = 20, before }: HistoryOptions = {},
  db: HistoryDb = prisma,
): Promise<HistoryGame[]> {
  if (!isUuid(userId)) return [];
  const rows = await db.gamePlayer.findMany({
    where: { userId, ...(before ? { game: { endedAt: { lt: before } } } : {}) },
    orderBy: [{ game: { endedAt: "desc" } }, { gameId: "desc" }],
    take: clampLimit(limit),
    select: {
      seat: true,
      role: true,
      won: true,
      left: true,
      alive: true,
      game: {
        select: {
          id: true,
          room: true,
          visibility: true,
          number: true,
          endedAt: true,
          outcome: true,
          winner: true,
          reason: true,
          players: {
            orderBy: { seat: "asc" },
            select: {
              seat: true,
              kind: true,
              userId: true,
              name: true,
              role: true,
              won: true,
              user: { select: { displayName: true } },
            },
          },
        },
      },
    },
  });

  return rows.map(({ game, ...you }) => ({
    id: game.id,
    room: game.room,
    visibility: game.visibility,
    number: game.number,
    endedAt: game.endedAt,
    outcome: game.outcome,
    winner: game.winner,
    reason: game.reason,
    you: { seat: you.seat, role: you.role, won: you.won, left: you.left, alive: you.alive },
    others: game.players
      .filter((p) => p.seat !== you.seat)
      .map((p) => ({
        seat: p.seat,
        name: shownName(p),
        role: p.role,
        won: p.won,
        userId: p.userId,
      })),
  }));
}
