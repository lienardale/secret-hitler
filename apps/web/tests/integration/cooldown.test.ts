/**
 * Quick-match cooldown (real Postgres): the 2nd public abandon within 24 h
 * holds quick match for 15 minutes after the latest one.
 */
import { describe, expect, it } from "vitest";

import {
  ABANDON_LIMIT,
  ABANDON_WINDOW_MS,
  COOLDOWN_MS,
  quickMatchCooldownUntil,
} from "@/lib/games/cooldown";
import { ingestGameResult } from "@/lib/games/ingest";

import { createAccount, gameResult } from "../_fixtures/game-result";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date(Date.parse("2026-11-03T12:00:00Z"));

let accounts = 0;

/** A fresh account with one game per entry: ended `ago` ms before NOW. */
async function playerWith(
  games: { ago: number; left?: boolean; visibility?: "public" | "private" }[],
): Promise<string> {
  const userId = await createAccount(`Cooldown ${++accounts}`);
  for (const game of games) {
    await ingestGameResult(
      gameResult({
        players: 5,
        users: { 2: userId },
        left: game.left === false ? [] : [2],
        visibility: game.visibility ?? "public",
        endedAt: NOW.getTime() - game.ago,
      }),
    );
  }
  return userId;
}

describe("quickMatchCooldownUntil", () => {
  it("uses 2 abandons in 24 hours and a 15-minute cooldown", () => {
    expect({ ABANDON_LIMIT, ABANDON_WINDOW_MS, COOLDOWN_MS }).toEqual({
      ABANDON_LIMIT: 2,
      ABANDON_WINDOW_MS: 24 * HOUR,
      COOLDOWN_MS: 15 * MINUTE,
    });
  });

  it("lets a player with no abandon, or a single one, play", async () => {
    expect(await quickMatchCooldownUntil(await playerWith([]), NOW)).toBeNull();
    expect(await quickMatchCooldownUntil(await playerWith([{ ago: MINUTE }]), NOW)).toBeNull();
  });

  it("holds quick match for 15 minutes after the 2nd abandon", async () => {
    const userId = await playerWith([{ ago: 2 * HOUR }, { ago: 5 * MINUTE }]);
    const until = new Date(NOW.getTime() + 10 * MINUTE);
    expect(await quickMatchCooldownUntil(userId, NOW)).toEqual(until);
    expect(await quickMatchCooldownUntil(userId, new Date(until.getTime() - 1))).toEqual(until);
    expect(await quickMatchCooldownUntil(userId, until)).toBeNull();
  });

  it("counts from the latest of 3 abandons", async () => {
    const userId = await playerWith([{ ago: 3 * HOUR }, { ago: 2 * MINUTE }, { ago: HOUR }]);
    expect(await quickMatchCooldownUntil(userId, NOW)).toEqual(
      new Date(NOW.getTime() + 13 * MINUTE),
    );
  });

  it("is over once the latest abandon is 15 minutes old", async () => {
    const userId = await playerWith([{ ago: 3 * HOUR }, { ago: 20 * MINUTE }]);
    expect(await quickMatchCooldownUntil(userId, NOW)).toBeNull();
  });

  it("ignores private games and games the player did not leave", async () => {
    const privateToo = await playerWith([
      { ago: HOUR },
      { ago: 5 * MINUTE, visibility: "private" },
    ]);
    expect(await quickMatchCooldownUntil(privateToo, NOW)).toBeNull();
    const stayed = await playerWith([{ ago: HOUR }, { ago: 5 * MINUTE, left: false }]);
    expect(await quickMatchCooldownUntil(stayed, NOW)).toBeNull();
  });

  it("forgets abandons older than 24 hours", async () => {
    const userId = await playerWith([{ ago: 25 * HOUR }, { ago: 5 * MINUTE }]);
    expect(await quickMatchCooldownUntil(userId, NOW)).toBeNull();
  });

  it("returns null for an id that is not a uuid", async () => {
    expect(await quickMatchCooldownUntil("not-a-uuid", NOW)).toBeNull();
  });
});
