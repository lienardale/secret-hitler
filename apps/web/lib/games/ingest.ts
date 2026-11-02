/**
 * Stores a game result delivered by a room's outbox (POST /api/internal/games).
 *
 * Delivery is at least once: the outbox retries for 3 days, and a delivery
 * that timed out may still be running when the next one arrives. So storing
 * is idempotent on `gameId`: the first delivery writes the game, its players
 * and its log in one transaction (a nested create); any later one finds the
 * row, or loses the race on the primary key, and changes nothing.
 *
 * Players: a guest keeps the name they played under. An account is linked by
 * its id (`sub`) only while it exists: an account deleted before the result
 * arrives is stored like one deleted after (`userId` and `name` NULL, shown
 * as "Deleted player").
 *
 * Never log the payload: it holds the game's seed and every move.
 */
import type { GameResultPayload } from "@sh/protocol";

import { isUniqueViolation } from "@/lib/db/errors";
import { prisma } from "@/lib/db/prisma";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import { isUuid } from "./ids";

/** `GamePlayer.name` is a VARCHAR(40). */
const NAME_MAX = 40;

export interface IngestResult {
  /** The game was already stored (a repeated or concurrent delivery). */
  duplicate: boolean;
}

/** The payload passed the schema but cannot be a real game: answer 400, never retry. */
export class InvalidGameResultError extends Error {
  override name = "InvalidGameResultError";
}

export type IngestDb = Pick<PrismaClient, "game" | "user">;

type Player = GameResultPayload["players"][number];

/** Why the payload cannot be stored, or null. Checks what the schema cannot express. */
export function gameResultProblem(payload: GameResultPayload): string | null {
  const seats = payload.players.map((p) => p.seat).sort((a, b) => a - b);
  if (seats.some((seat, i) => seat !== i)) return "seats must be 0..n-1, once each";
  const started = new Date(payload.startedAt).getTime();
  const ended = new Date(payload.endedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended)) return "times out of range";
  if (ended < started) return "the game ends before it starts";
  return null;
}

/** First 40 characters (code points, as Postgres counts them). */
function truncateName(name: string): string {
  return Array.from(name).slice(0, NAME_MAX).join("");
}

function playerRow(player: Player, liveUsers: ReadonlySet<string>) {
  const linked = player.kind === "user" && liveUsers.has(player.sub);
  return {
    seat: player.seat,
    kind: player.kind,
    userId: linked ? player.sub : null,
    // A guest keeps their name; an account without a live user is a deleted player.
    name: player.kind === "guest" || linked ? truncateName(player.name) : null,
    role: player.role,
    alive: player.alive,
    won: player.won,
    left: player.left,
  };
}

/** The `Game` create input (with its players and log) for a checked payload. */
export function gameCreateInput(
  payload: GameResultPayload,
  liveUsers: ReadonlySet<string>,
): Prisma.GameCreateInput {
  const { result } = payload;
  return {
    id: payload.gameId,
    room: payload.room,
    visibility: payload.visibility,
    lang: payload.lang,
    number: payload.number,
    startedAt: new Date(payload.startedAt),
    endedAt: new Date(payload.endedAt),
    outcome: result.kind,
    winner: result.kind === "finished" ? result.winner : null,
    reason: result.kind === "finished" ? result.reason : null,
    players: { create: payload.players.map((p) => playerRow(p, liveUsers)) },
    log: { create: { data: payload.log as Prisma.InputJsonObject } },
  };
}

async function gameExists(db: IngestDb, id: string): Promise<boolean> {
  return (await db.game.findUnique({ where: { id }, select: { id: true } })) !== null;
}

/** The account ids among the players that still exist. */
async function liveUserIds(db: IngestDb, payload: GameResultPayload): Promise<Set<string>> {
  const ids = payload.players.flatMap((p) => (p.kind === "user" && isUuid(p.sub) ? [p.sub] : []));
  if (ids.length === 0) return new Set();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(users.map((u) => u.id));
}

/**
 * Stores the game unless it is already stored. Throws `InvalidGameResultError`
 * for a payload that can never be stored, and lets database errors through
 * (the route answers 500 and the outbox retries).
 */
export async function ingestGameResult(
  payload: GameResultPayload,
  deps: { db?: IngestDb } = {},
): Promise<IngestResult> {
  const db = deps.db ?? prisma;
  const problem = gameResultProblem(payload);
  if (problem !== null) throw new InvalidGameResultError(problem);

  if (await gameExists(db, payload.gameId)) return { duplicate: true };
  const data = gameCreateInput(payload, await liveUserIds(db, payload));
  try {
    await db.game.create({ data, select: { id: true } });
    return { duplicate: false };
  } catch (error) {
    // A concurrent delivery committed first. Re-read so an unrelated unique
    // violation is never mistaken for a duplicate.
    if (isUniqueViolation(error) && (await gameExists(db, payload.gameId))) {
      return { duplicate: true };
    }
    throw error;
  }
}
