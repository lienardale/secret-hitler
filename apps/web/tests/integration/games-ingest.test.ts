/**
 * Game results from the rooms Worker (real Postgres): idempotent storage on
 * `gameId`, accounts vs guests vs deleted accounts, and the signed route.
 */
import { SIGNATURE_HEADER, signRequest } from "@sh/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/internal/games/route";
import { prisma } from "@/lib/db/prisma";
import { InvalidGameResultError, ingestGameResult } from "@/lib/games/ingest";

import { createAccount, gameResult } from "../_fixtures/game-result";

// Before anything calls getEnv() (it caches): the route checks the whole contract.
const SECRET = vi.hoisted(() => {
  const secret = "test-rooms-to-web-secret-0123456789abcdef";
  process.env.ROOMS_TO_WEB_SECRET = secret;
  process.env.ROOMS_URL ??= "http://localhost:8787";
  process.env.TICKET_PRIVATE_JWK ??= '{"kty":"OKP","crv":"Ed25519","x":"test","d":"test"}';
  process.env.WEB_TO_ROOMS_SECRET ??= "test-web-to-rooms-secret-0123456789abcdef";
  process.env.GUEST_SECRET ??= "test-guest-secret-0123456789abcdefghijkl";
  return secret;
});

const PATH = "/api/internal/games";

async function counts(gameId: string) {
  const [games, players, logs] = await Promise.all([
    prisma.game.count({ where: { id: gameId } }),
    prisma.gamePlayer.count({ where: { gameId } }),
    prisma.gameLog.count({ where: { gameId } }),
  ]);
  return { games, players, logs };
}

/** Calls the route handler like the outbox does; `signature: null` sends none. */
async function post(
  body: string,
  options: { signature?: string | null; secret?: string; signedAt?: number } = {},
): Promise<Response> {
  const signature =
    options.signature !== undefined
      ? options.signature
      : await signRequest(
          options.secret ?? SECRET,
          { method: "POST", path: PATH, body },
          options.signedAt,
        );
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set(SIGNATURE_HEADER, signature);
  return POST(new Request(`http://localhost:3000${PATH}`, { method: "POST", body, headers }));
}

afterEach(() => vi.restoreAllMocks());

describe("ingestGameResult", () => {
  it("stores a full game: the game, its 10 players and the log", async () => {
    const payload = gameResult({ left: [4] });
    expect(await ingestGameResult(payload)).toEqual({ duplicate: false });
    expect(await counts(payload.gameId)).toEqual({ games: 1, players: 10, logs: 1 });

    const game = await prisma.game.findUniqueOrThrow({
      where: { id: payload.gameId },
      include: { players: { orderBy: { seat: "asc" } }, log: true },
    });
    if (payload.result.kind !== "finished") throw new Error("the fixture game is finished");
    expect(game).toMatchObject({
      room: "BCDFG",
      visibility: "public",
      lang: "fr",
      number: 1,
      startedAt: new Date(payload.startedAt),
      endedAt: new Date(payload.endedAt),
      outcome: "finished",
      winner: payload.result.winner,
      reason: payload.result.reason,
    });
    expect(game.log?.data).toEqual(payload.log);
    expect(game.players).toEqual(
      payload.players.map((p) => ({
        gameId: payload.gameId,
        seat: p.seat,
        kind: "guest",
        userId: null,
        name: p.name,
        role: p.role,
        alive: p.alive,
        won: p.won,
        left: p.seat === 4,
      })),
    );
  });

  it("stores an abandoned game without winner or reason", async () => {
    const payload = gameResult({ abandoned: true, players: 5 });
    await ingestGameResult(payload);
    const game = await prisma.game.findUniqueOrThrow({ where: { id: payload.gameId } });
    expect(game).toMatchObject({ outcome: "abandoned", winner: null, reason: null });
    expect(await prisma.gamePlayer.count({ where: { gameId: payload.gameId, won: true } })).toBe(0);
  });

  it("answers duplicate to a repeated delivery and changes nothing", async () => {
    const payload = gameResult();
    await ingestGameResult(payload);
    const again = { ...payload, players: payload.players.map((p) => ({ ...p, name: "Changed" })) };
    expect(await ingestGameResult(again)).toEqual({ duplicate: true });
    expect(await ingestGameResult(payload)).toEqual({ duplicate: true });
    expect(await counts(payload.gameId)).toEqual({ games: 1, players: 10, logs: 1 });
    expect(await prisma.gamePlayer.count({ where: { name: "Changed" } })).toBe(0);
  });

  it("stores concurrent deliveries once, and every one succeeds", async () => {
    // Losing the race on the primary key is expected; its log line must not carry the payload.
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    const payload = gameResult();
    const results = await Promise.all(Array.from({ length: 5 }, () => ingestGameResult(payload)));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await counts(payload.gameId)).toEqual({ games: 1, players: 10, logs: 1 });
    for (const line of lines) {
      expect(line).not.toContain("Guest");
      expect(line).not.toContain("nominate");
    }
  });

  it("links live accounts, and stores missing or deleted ones as deleted players", async () => {
    const alice = await createAccount("Alice");
    const gone = await createAccount("Gone");
    await prisma.user.delete({ where: { id: gone } });
    const unknown = "00000000-0000-4000-8000-00000000abcd";
    const payload = gameResult({ users: { 0: alice, 1: gone, 2: unknown, 3: "not-a-uuid" } });
    await ingestGameResult(payload);

    const players = await prisma.gamePlayer.findMany({
      where: { gameId: payload.gameId },
      orderBy: { seat: "asc" },
      select: { seat: true, kind: true, userId: true, name: true },
    });
    expect(players.slice(0, 5)).toEqual([
      { seat: 0, kind: "user", userId: alice, name: "Account 0" },
      { seat: 1, kind: "user", userId: null, name: null },
      { seat: 2, kind: "user", userId: null, name: null },
      { seat: 3, kind: "user", userId: null, name: null },
      { seat: 4, kind: "guest", userId: null, name: "Guest 4" },
    ]);
    expect(players.slice(5).every((p) => p.kind === "guest" && p.name !== null)).toBe(true);
  });

  it("refuses a payload whose seats are not 0..n-1, or whose times make no sense", async () => {
    const payload = gameResult({ players: 5 });
    const twice = {
      ...payload,
      players: payload.players.map((p) => (p.seat === 4 ? { ...p, seat: 3 } : p)),
    };
    await expect(ingestGameResult(twice)).rejects.toBeInstanceOf(InvalidGameResultError);
    const backwards = { ...payload, endedAt: payload.startedAt - 1 };
    await expect(ingestGameResult(backwards)).rejects.toBeInstanceOf(InvalidGameResultError);
    const outOfRange = { ...payload, startedAt: 9e15, endedAt: 9e15 };
    await expect(ingestGameResult(outOfRange)).rejects.toBeInstanceOf(InvalidGameResultError);
    expect(await counts(payload.gameId)).toEqual({ games: 0, players: 0, logs: 0 });
  });
});

describe("POST /api/internal/games", () => {
  it("stores a signed result, then answers duplicate", async () => {
    const payload = gameResult();
    const body = JSON.stringify(payload);

    const first = await post(body);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ ok: true, duplicate: false });

    const second = await post(body);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(await counts(payload.gameId)).toEqual({ games: 1, players: 10, logs: 1 });
  });

  it("reads `left` as false from a room that predates it", async () => {
    const payload = gameResult({ players: 5 });
    const older = {
      ...payload,
      players: payload.players.map((p) => {
        const copy: Partial<typeof p> = { ...p };
        delete copy.left;
        return copy;
      }),
    };
    expect((await post(JSON.stringify(older))).status).toBe(200);
    expect(await prisma.gamePlayer.count({ where: { gameId: payload.gameId, left: false } })).toBe(
      5,
    );
  });

  it("refuses a missing, forged or stale signature with 401 and stores nothing", async () => {
    const payload = gameResult();
    const body = JSON.stringify(payload);
    const forged = await post(body, { secret: "another-secret-0123456789abcdefghijklmn" });
    expect(forged.status).toBe(401);
    expect(forged.headers.get("cache-control")).toBe("no-store");
    expect((await post(body, { signature: null })).status).toBe(401);
    expect((await post(body, { signature: "t=1,v1=nothex" })).status).toBe(401);
    expect((await post(body, { signedAt: Date.now() - 6 * 60_000 })).status).toBe(401);

    // A signature covers the body: another body under a valid signature is forged too.
    const signature = await signRequest(SECRET, { method: "POST", path: PATH, body });
    const tampered = JSON.stringify({ ...payload, number: 2 });
    expect((await post(tampered, { signature })).status).toBe(401);
    expect(await counts(payload.gameId)).toEqual({ games: 0, players: 0, logs: 0 });
  });

  it("answers 400 to invalid JSON and to invalid payloads (the outbox then drops them)", async () => {
    const bad = await post("{not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_json" });

    const payload = gameResult({ players: 5 });
    const invalid = await post(JSON.stringify({ ...payload, gameId: "nope" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_payload" });

    const extra = await post(JSON.stringify({ ...payload, extra: true }));
    expect(extra.status).toBe(400);

    const twice = {
      ...payload,
      players: payload.players.map((p) => (p.seat === 4 ? { ...p, seat: 0 } : p)),
    };
    expect((await post(JSON.stringify(twice))).status).toBe(400);
    expect(await counts(payload.gameId)).toEqual({ games: 0, players: 0, logs: 0 });
  });

  it("answers 413 to a body over 256 KB", async () => {
    const huge = JSON.stringify({ padding: "x".repeat(256 * 1024) });
    expect((await post(huge)).status).toBe(413);
  });
});
