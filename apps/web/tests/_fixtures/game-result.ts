/**
 * Valid game results, as a room's outbox sends them: a real game played by
 * the engine (random legal moves from a fixed seed), so roles, winners and the
 * log are consistent and the payload passes the strict protocol schema. Plus
 * the accounts that play them (integration tier: real Postgres).
 */
import { STATE_VERSION, outcome, partyOf, playRandomGame, seededRandom } from "@sh/engine";
import { gameResultPayloadSchema, nameKey, type GameResultPayload } from "@sh/protocol";

import { prisma } from "@/lib/db/prisma";

export type ResultPlayer = GameResultPayload["players"][number];

export const STARTED_AT = Date.parse("2026-11-02T10:00:00Z");

export interface GameResultOptions {
  gameId?: string;
  players?: number;
  /** Seat → account id: those seats are accounts (`kind: "user"`), the rest guests. */
  users?: Record<number, string>;
  visibility?: GameResultPayload["visibility"];
  endedAt?: number;
  /** Abandoned: nobody wins. */
  abandoned?: boolean;
  /** Seats the room was playing for at the end. */
  left?: number[];
  seed?: number;
}

/** A fresh uuid per call, so every built game is a new one unless `gameId` is given. */
export function newGameId(): string {
  return crypto.randomUUID();
}

export function gameResult(options: GameResultOptions = {}): GameResultPayload {
  const count = options.players ?? 10;
  const seedNumber = options.seed ?? 1;
  const seed: [number, number, number, number] = [seedNumber, 2, 3, 4];
  const { state, moves } = playRandomGame(count, seed, seededRandom(seedNumber));
  const end = outcome(state);
  if (!end) throw new Error("the fixture game did not end");
  const endedAt = options.endedAt ?? STARTED_AT + 20 * 60_000;
  const users = options.users ?? {};
  const left = new Set(options.left ?? []);

  const players = state.roles.map((role, seat): ResultPlayer => {
    const sub = users[seat];
    return {
      seat,
      kind: sub === undefined ? "guest" : "user",
      sub: sub ?? `guest-${seat}`,
      name: sub === undefined ? `Guest ${seat}` : `Account ${seat}`,
      role,
      alive: state.alive[seat] === true,
      won: !options.abandoned && partyOf(role) === end.winner,
      left: left.has(seat),
    };
  });

  return gameResultPayloadSchema.parse({
    gameId: options.gameId ?? newGameId(),
    room: "BCDFG",
    visibility: options.visibility ?? "public",
    lang: "fr",
    number: 1,
    startedAt: Math.min(STARTED_AT, endedAt),
    endedAt,
    result: options.abandoned
      ? { kind: "abandoned" }
      : { kind: "finished", winner: end.winner, reason: end.reason },
    players,
    log: {
      game: "secret-hitler",
      stateVersion: STATE_VERSION,
      seed,
      moves: moves.map((move, i) => ({
        seat: move.seat,
        action: move.action,
        at: STARTED_AT + i * 1_000,
        auto: false,
      })),
    },
  } satisfies GameResultPayload);
}

/** An onboarded account; returns its id. */
export async function createAccount(displayName: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${nameKey(displayName).replace(/[^a-z0-9]/g, "-")}-${crypto.randomUUID()}@example.test`,
      displayName,
      displayNameKey: nameKey(displayName),
    },
    select: { id: true },
  });
  return user.id;
}
