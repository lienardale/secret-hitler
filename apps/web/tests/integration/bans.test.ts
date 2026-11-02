/**
 * Bans at every gate (real Postgres): the ticket route answers 403 `banned`
 * to a suspended account and records the visits of the others; quick match
 * and room creation refuse a suspended account. Expired and revoked bans no
 * longer count, and guests are never refused for a ban.
 *
 * The request (headers, cookies) is faked; the session cookie is a real
 * Auth.js token, so `getCurrentUser()` runs as in production.
 */
import { exportJWK, generateKeyPair } from "jose";
import { importTicketPublicKey, nameKey, verifyTicket } from "@sh/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => {
  process.env.ROOMS_URL ??= "http://localhost:8787";
  process.env.WEB_TO_ROOMS_SECRET ??= "test-web-to-rooms-secret-0123456789abcdef";
  process.env.ROOMS_TO_WEB_SECRET ??= "test-rooms-to-web-secret-0123456789abcdef";
  process.env.GUEST_SECRET ??= "test-guest-secret-0123456789abcdefghijkl";
  return { headers: new Headers(), cookies: new Map<string, string>() };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      request.cookies.set(name, value);
    },
  }),
}));
const rooms = vi.hoisted(() => ({
  createRoom: vi.fn(async () => "HJKLM"),
  quickMatch: vi.fn(async () => "BCDFG"),
  roomInfo: vi.fn(),
}));
vi.mock("@/lib/rooms/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rooms/api")>()),
  ...rooms,
}));
const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("@/lib/i18n/navigation", () => navigation);

const { createRoomAction } = await import("@/app/[locale]/actions");
const { quickMatchAction } = await import("@/app/[locale]/jouer/actions");
const { POST: ticketRoute } = await import("@/app/api/rooms/[code]/ticket/route");
const { SESSION_COOKIE_NAME, mintSessionToken } = await import("@/lib/auth/session-token");
const { prisma } = await import("@/lib/db/prisma");
const { GUEST_COOKIE, signGuest } = await import("@/lib/guest/cookie");
const { activeBan } = await import("@/lib/moderation/bans");
const { VISIT_TTL_MS } = await import("@/lib/moderation/visits");
const { ingestGameResult } = await import("@/lib/games/ingest");
const { gameResult } = await import("../_fixtures/game-result");

const ORIGIN = "http://localhost:3000";
const HOUR = 60 * 60_000;
let publicKey: Awaited<ReturnType<typeof importTicketPublicKey>>;

beforeAll(async () => {
  // A real key pair: the route signs tickets with it (getEnv() reads it on first use).
  const pair = await generateKeyPair("Ed25519", { extractable: true });
  process.env.TICKET_PRIVATE_JWK = JSON.stringify(await exportJWK(pair.privateKey));
  publicKey = await importTicketPublicKey(await exportJWK(pair.publicKey));
});

beforeEach(() => {
  request.headers = new Headers({ origin: ORIGIN, host: "localhost:3000" });
  request.cookies.clear();
  vi.clearAllMocks();
});

let accounts = 0;
/** An onboarded account; returns its id. */
async function onboardedAccount(): Promise<string> {
  accounts += 1;
  const displayName = `Player ${accounts}`;
  const user = await prisma.user.create({
    data: {
      email: `player-${accounts}-${crypto.randomUUID()}@example.test`,
      displayName,
      displayNameKey: nameKey(displayName),
      ageConfirmedAt: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

async function signIn(userId: string): Promise<void> {
  const secret = process.env.AUTH_SECRET as string;
  request.cookies.set(
    SESSION_COOKIE_NAME,
    await mintSessionToken(
      { id: userId, sessionVersion: 0 },
      { secret, cookieName: SESSION_COOKIE_NAME },
    ),
  );
}

async function asGuest(gid = `guest-${crypto.randomUUID().slice(0, 18)}`): Promise<string> {
  request.cookies.set(
    GUEST_COOKIE,
    await signGuest({ gid, name: "Ada" }, process.env.GUEST_SECRET as string),
  );
  return gid;
}

async function ban(
  userId: string,
  options: { expiresAt?: Date | null; revokedAt?: Date | null; reason?: string } = {},
) {
  return prisma.ban.create({
    data: {
      userId,
      reason: options.reason ?? "Repeated insults in the chat.",
      expiresAt: options.expiresAt ?? null,
      revokedAt: options.revokedAt ?? null,
    },
  });
}

function ticket(code = "BCDFG", origin = ORIGIN): Promise<Response> {
  const headers = new Headers({ origin, host: "localhost:3000" });
  return ticketRoute(
    new Request(`${ORIGIN}/api/rooms/${code}/ticket`, { method: "POST", headers }),
    {
      params: Promise.resolve({ code }),
    },
  );
}

async function ticketClaims(response: Response) {
  const { url } = (await response.json()) as { url: string };
  const token = new URL(url).searchParams.get("t") ?? "";
  const verified = await verifyTicket(token, publicKey, {
    room: new URL(url).pathname.split("/")[3] as string,
  });
  if (!verified.ok) throw new Error("the route signed an invalid ticket");
  return verified.ticket;
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("activeBan", () => {
  it("permanent and future bans are active; expired and revoked ones are not", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const id = await onboardedAccount();
    expect(await activeBan(prisma, id, now)).toBeNull();

    await ban(id, { expiresAt: new Date(now.getTime() - 1) });
    await ban(id, { revokedAt: now });
    expect(await activeBan(prisma, id, now)).toBeNull();

    const week = await ban(id, { expiresAt: new Date(now.getTime() + 7 * 24 * HOUR) });
    expect((await activeBan(prisma, id, now))?.id).toBe(week.id);
    const forever = await ban(id, { expiresAt: null, reason: "Hate speech." });
    expect(await activeBan(prisma, id, now)).toMatchObject({
      id: forever.id,
      reason: "Hate speech.",
      expiresAt: null,
    });
  });
});

describe("POST /api/rooms/:code/ticket", () => {
  it("answers 403 banned to a suspended account, issues nothing and records no visit", async () => {
    const id = await onboardedAccount();
    await ban(id, { expiresAt: new Date(Date.now() + HOUR) });
    await signIn(id);

    const response = await ticket();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "banned" });
    expect(await prisma.roomVisit.count({ where: { userId: id } })).toBe(0);
  });

  it("refuses a permanent ban too", async () => {
    const id = await onboardedAccount();
    await ban(id);
    await signIn(id);
    expect(await (await ticket()).json()).toEqual({ error: "banned" });
  });

  it("issues an account ticket once the ban has expired", async () => {
    const id = await onboardedAccount();
    await ban(id, { expiresAt: new Date(Date.now() - 1000) });
    await signIn(id);

    const response = await ticket();
    expect(response.status).toBe(200);
    expect(await ticketClaims(response)).toMatchObject({ kind: "user", sub: id, room: "BCDFG" });
  });

  it("issues an account ticket once the ban is revoked", async () => {
    const id = await onboardedAccount();
    await ban(id, { revokedAt: new Date() });
    await signIn(id);

    const response = await ticket();
    expect(response.status).toBe(200);
    expect(await ticketClaims(response)).toMatchObject({ kind: "user", sub: id });
  });

  it("records the visit for every account ticket (one row per room, latest time)", async () => {
    const id = await onboardedAccount();
    await signIn(id);
    // A visit older than a week is pruned by the next ticket.
    await prisma.roomVisit.create({
      data: { userId: id, room: "ZZZZZ", lastAt: new Date(Date.now() - VISIT_TTL_MS - 1000) },
    });

    expect((await ticket("BCDFG")).status).toBe(200);
    const first = await prisma.roomVisit.findUniqueOrThrow({
      where: { userId_room: { userId: id, room: "BCDFG" } },
    });
    expect((await ticket("BCDFG")).status).toBe(200);
    expect((await ticket("HJKLM")).status).toBe(200);

    const visits = await prisma.roomVisit.findMany({
      where: { userId: id },
      orderBy: { room: "asc" },
    });
    expect(visits.map((v) => v.room)).toEqual(["BCDFG", "HJKLM"]);
    expect(visits[0]?.lastAt.getTime()).toBeGreaterThanOrEqual(first.lastAt.getTime());
  });

  it("never refuses a guest: a guest cookie gets its ticket (no visit row)", async () => {
    const gid = await asGuest();
    const visits = await prisma.roomVisit.count();
    const response = await ticket();
    expect(response.status).toBe(200);
    expect(await ticketClaims(response)).toMatchObject({ kind: "guest", sub: gid });
    expect(await prisma.roomVisit.count()).toBe(visits);
  });

  it("a suspended account that signed out plays as the guest its browser holds", async () => {
    const id = await onboardedAccount();
    await ban(id);
    const gid = await asGuest();
    // Signed in: the account is refused, even with a guest cookie next to it.
    await signIn(id);
    expect((await ticket()).status).toBe(403);
    // Signed out: bans apply to accounts only.
    request.cookies.delete(SESSION_COOKIE_NAME);
    const response = await ticket();
    expect(response.status).toBe(200);
    expect(await ticketClaims(response)).toMatchObject({ kind: "guest", sub: gid });
  });

  it("still answers 401 no_guest, 404 and 403 forbidden as before", async () => {
    expect(await (await ticket()).json()).toEqual({ error: "no_guest" });
    expect((await ticket("AAAAA")).status).toBe(404);
    const crossSite = await ticket("BCDFG", "https://evil.example");
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "forbidden" });
  });
});

describe("POST /api/rooms/:code/ticket — abandon cooldown", () => {
  /** Two public games the account left, the latest one `ago` ms ago. */
  async function leftTwoPublicGames(userId: string, ago = 60_000): Promise<void> {
    for (const offset of [ago + HOUR, ago]) {
      await ingestGameResult(
        gameResult({
          players: 5,
          users: { 2: userId },
          left: [2],
          visibility: "public",
          endedAt: Date.now() - offset,
        }),
      );
    }
  }
  const info = (visibility: "public" | "private", status: "lobby" | "playing" | "ended") => ({
    code: "BCDFG",
    visibility,
    lang: "fr",
    status,
    players: 3,
    spectators: 0,
  });

  it("refuses a seat in a public lobby with the time it ends", async () => {
    const id = await onboardedAccount();
    await leftTwoPublicGames(id);
    await signIn(id);
    rooms.roomInfo.mockResolvedValue(info("public", "lobby"));

    const response = await ticket();
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; until: number };
    expect(body.error).toBe("cooldown");
    expect(body.until).toBeGreaterThan(Date.now() + 13 * 60_000);
    expect(body.until).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    expect(rooms.roomInfo).toHaveBeenCalledWith("BCDFG");
  });

  it("lets the account into private rooms and public games already running or over", async () => {
    const id = await onboardedAccount();
    await leftTwoPublicGames(id);
    await signIn(id);
    for (const [visibility, status] of [
      ["private", "lobby"],
      ["public", "playing"],
      ["public", "ended"],
    ] as const) {
      rooms.roomInfo.mockResolvedValueOnce(info(visibility, status));
      expect((await ticket()).status).toBe(200);
    }
    // The Worker cannot say: not refused (the socket would fail on its own).
    rooms.roomInfo.mockRejectedValueOnce(new Error("down"));
    expect((await ticket()).status).toBe(200);
  });

  it("asks the Worker nothing for an account without a cooldown, and ends after 15 minutes", async () => {
    const fresh = await onboardedAccount();
    await signIn(fresh);
    expect((await ticket()).status).toBe(200);
    expect(rooms.roomInfo).not.toHaveBeenCalled();

    const past = await onboardedAccount();
    await leftTwoPublicGames(past, 16 * 60_000);
    await signIn(past);
    expect((await ticket()).status).toBe(200);
    expect(rooms.roomInfo).not.toHaveBeenCalled();
  });
});

describe("quickMatchAction", () => {
  it("refuses a suspended account with `banned` and never calls the lobby", async () => {
    const id = await onboardedAccount();
    await ban(id, { expiresAt: new Date(Date.now() + HOUR) });
    await signIn(id);

    expect(await quickMatchAction(null, form({ locale: "fr" }))).toEqual({
      ok: false,
      error: "banned",
    });
    expect(rooms.quickMatch).not.toHaveBeenCalled();
    expect(rooms.createRoom).not.toHaveBeenCalled();
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it("lets the account play again once the ban is revoked", async () => {
    const id = await onboardedAccount();
    await ban(id, { revokedAt: new Date() });
    await signIn(id);

    expect(await quickMatchAction(null, form({ locale: "fr" }))).toBeNull();
    expect(rooms.quickMatch).toHaveBeenCalledOnce();
    expect(navigation.redirect).toHaveBeenCalledWith({
      href: { pathname: "/salle/[code]", params: { code: "BCDFG" } },
      locale: "fr",
    });
  });
});

describe("createRoomAction", () => {
  it("refuses a suspended account with `banned` and creates nothing", async () => {
    const id = await onboardedAccount();
    await ban(id);
    await signIn(id);
    const buckets = await prisma.rateLimit.count();

    expect(await createRoomAction(null, form({ locale: "en" }))).toEqual({
      ok: false,
      error: "banned",
    });
    expect(rooms.createRoom).not.toHaveBeenCalled();
    // Refused before the limits: nothing counted.
    expect(await prisma.rateLimit.count()).toBe(buckets);
  });

  it("creates the room for an account whose ban expired", async () => {
    const id = await onboardedAccount();
    await ban(id, { expiresAt: new Date(Date.now() - 1000) });
    await signIn(id);

    expect(await createRoomAction(null, form({ locale: "en" }))).toEqual({ ok: true });
    expect(rooms.createRoom).toHaveBeenCalledWith({
      visibility: "private",
      lang: "en",
      host: { kind: "user", sub: id, name: expect.stringMatching(/^Player \d+$/) },
    });
  });

  it("never refuses a guest", async () => {
    const gid = await asGuest();
    expect(await createRoomAction(null, form({ locale: "fr" }))).toEqual({ ok: true });
    expect(rooms.createRoom).toHaveBeenCalledWith({
      visibility: "private",
      lang: "fr",
      host: { kind: "guest", sub: gid, name: "Ada" },
    });
  });
});
