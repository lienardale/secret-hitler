/**
 * Profile history (real Postgres): newest first, `before` pagination, and the
 * names shown for live accounts, guests and deleted accounts.
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { userGameHistory } from "@/lib/games/history";
import { ingestGameResult } from "@/lib/games/ingest";

import { STARTED_AT, createAccount, gameResult } from "../_fixtures/game-result";

const HOUR = 60 * 60_000;

async function store(...args: Parameters<typeof gameResult>) {
  const payload = gameResult(...args);
  await ingestGameResult(payload);
  return payload;
}

describe("userGameHistory", () => {
  it("lists the user's games newest first, with their own seat and the others", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    const older = await store({ users: { 0: alice, 1: bob }, endedAt: STARTED_AT + HOUR });
    const newer = await store({
      users: { 3: alice, 0: bob },
      players: 5,
      endedAt: STARTED_AT + 3 * HOUR,
      left: [3],
      seed: 2,
    });
    await store({ users: { 0: bob }, endedAt: STARTED_AT + 5 * HOUR }); // without Alice

    const history = await userGameHistory(alice);
    expect(history.map((g) => g.id)).toEqual([newer.gameId, older.gameId]);

    const [game] = history;
    const mine = newer.players[3];
    if (!game || !mine) throw new Error("missing game");
    expect(game).toMatchObject({
      room: "BCDFG",
      visibility: "public",
      number: 1,
      endedAt: new Date(newer.endedAt),
      outcome: newer.result.kind,
    });
    expect(game.you).toEqual({
      seat: 3,
      role: mine.role,
      won: mine.won,
      left: true,
      alive: mine.alive,
    });
    expect(game.others.map((p) => p.seat)).toEqual([0, 1, 2, 4]);
    expect(game.others[0]).toEqual({
      seat: 0,
      name: "Bob",
      role: newer.players[0]?.role,
      won: newer.players[0]?.won,
      userId: bob,
    });
    expect(game.others[1]).toMatchObject({ seat: 1, name: "Guest 1", userId: null });
  });

  it("pages with `limit` and `before`", async () => {
    const carol = await createAccount("Carol");
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const payload = await store({ users: { 0: carol }, endedAt: STARTED_AT + i * HOUR });
      ids.unshift(payload.gameId);
    }
    const first = await userGameHistory(carol, { limit: 2 });
    expect(first.map((g) => g.id)).toEqual(ids.slice(0, 2));
    const next = await userGameHistory(carol, { limit: 2, before: first.at(-1)?.endedAt });
    expect(next.map((g) => g.id)).toEqual(ids.slice(2, 4));
    const rest = await userGameHistory(carol, { before: next.at(-1)?.endedAt });
    expect(rest).toEqual([]);
    expect(await userGameHistory(carol)).toHaveLength(4);
  });

  it("shows current display names, stored guest names, and deleted accounts as null", async () => {
    const dana = await createAccount("Dana");
    const erin = await createAccount("Erin");
    const gone = await createAccount("Gone");
    await prisma.user.delete({ where: { id: gone } });
    const later = await createAccount("Later");
    await store({ users: { 0: dana, 1: erin, 2: gone, 3: later }, players: 5 });

    // Erin renames after the game; Later deletes their account after it was stored.
    await prisma.user.update({ where: { id: erin }, data: { displayName: "Erin2" } });
    await prisma.user.delete({ where: { id: later } });

    const [game] = await userGameHistory(dana);
    expect(game?.others.map(({ seat, name, userId }) => ({ seat, name, userId }))).toEqual([
      { seat: 1, name: "Erin2", userId: erin },
      { seat: 2, name: null, userId: null },
      { seat: 3, name: null, userId: null },
      { seat: 4, name: "Guest 4", userId: null },
    ]);
  });

  it("returns nothing for an unknown user or an id that is not a uuid", async () => {
    expect(await userGameHistory("00000000-0000-4000-8000-000000000000")).toEqual([]);
    expect(await userGameHistory("not-a-uuid")).toEqual([]);
  });
});
