/**
 * The moderation rate limits on the database limiter (real Postgres), so they
 * hold across serverless instances (docs/plan.md § Moderation): reports 10 per
 * hour per account, room creation 10 per hour per identity and per address,
 * guest cookies 20 per hour per address. Keys are salted hashes, and the
 * `local` sentinel (no proxy header) is not throttled outside production.
 */
import { identityKey, nameKey } from "@sh/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => {
  process.env.ROOMS_URL ??= "http://localhost:8787";
  process.env.TICKET_PRIVATE_JWK ??= '{"kty":"OKP","crv":"Ed25519","x":"test","d":"test"}';
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
  quickMatch: vi.fn(),
  roomInfo: vi.fn(),
}));
vi.mock("@/lib/rooms/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rooms/api")>()),
  ...rooms,
}));
vi.mock("@/lib/i18n/navigation", () => ({ redirect: vi.fn() }));

const { createRoomAction, saveGuestNameAction } = await import("@/app/[locale]/actions");
const { SESSION_COOKIE_NAME, mintSessionToken } = await import("@/lib/auth/session-token");
const { prisma } = await import("@/lib/db/prisma");
const { GUEST_COOKIE, verifyGuest } = await import("@/lib/guest/cookie");
const { LOCAL_CLIENT } = await import("@/lib/security/client-ip");
const { DB_RATE_LIMITS, allowAllRateLimiter, createDbRateLimiter, ipRateLimiter, rateLimitKey } =
  await import("@/lib/security/db-rate-limit");

const HOUR = 60 * 60_000;

beforeEach(() => {
  request.cookies.clear();
  vi.clearAllMocks();
});

/** A same-origin request from `ip` (none: no proxy header, the `local` sentinel). */
function from(ip?: string): void {
  request.headers = new Headers({ origin: "http://localhost:3000", host: "localhost:3000" });
  if (ip) request.headers.set("x-real-ip", ip);
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function guestId(): Promise<string> {
  const guest = await verifyGuest(
    request.cookies.get(GUEST_COOKIE),
    process.env.GUEST_SECRET as string,
  );
  if (!guest) throw new Error("no guest cookie");
  return guest.gid;
}

async function bucketCount(key: string): Promise<number | undefined> {
  return (await prisma.rateLimit.findUnique({ where: { key }, select: { count: true } }))?.count;
}

describe("the buckets", () => {
  it("are 10 reports, 10 rooms per identity and per address, 20 guest cookies, per hour", () => {
    expect(DB_RATE_LIMITS.reportPerUser).toEqual({ max: 10, windowMs: HOUR });
    expect(DB_RATE_LIMITS.roomCreationPerIdentity).toEqual({ max: 10, windowMs: HOUR });
    expect(DB_RATE_LIMITS.roomCreationPerIp).toEqual({ max: 10, windowMs: HOUR });
    expect(DB_RATE_LIMITS.guestCookiePerIp).toEqual({ max: 20, windowMs: HOUR });
  });

  it("per-address buckets skip the `local` sentinel outside production only", () => {
    expect(ipRateLimiter(prisma, LOCAL_CLIENT, false)).toBe(allowAllRateLimiter);
    expect(ipRateLimiter(prisma, LOCAL_CLIENT, true)).not.toBe(allowAllRateLimiter);
    expect(ipRateLimiter(prisma, "203.0.113.9", false)).not.toBe(allowAllRateLimiter);
  });
});

describe("reports: 10 per hour per account", () => {
  it("the 11th report within the hour is refused, the window reopens after an hour", async () => {
    let now = Date.parse("2026-11-02T10:00:00Z");
    const limiter = createDbRateLimiter(prisma, () => now);
    const account = "11111111-1111-4111-8111-111111111111";
    const key = rateLimitKey("report", account);

    for (let i = 1; i <= 10; i++) {
      expect(await limiter.consume(key, DB_RATE_LIMITS.reportPerUser)).toMatchObject({ ok: true });
    }
    const refused = await limiter.consume(key, DB_RATE_LIMITS.reportPerUser);
    expect(refused).toMatchObject({ ok: false, retryAfterMs: HOUR });
    // Another account is not affected.
    const other = rateLimitKey("report", "22222222-2222-4222-8222-222222222222");
    expect((await limiter.consume(other, DB_RATE_LIMITS.reportPerUser)).ok).toBe(true);

    now += HOUR + 1;
    expect(await limiter.consume(key, DB_RATE_LIMITS.reportPerUser)).toMatchObject({
      ok: true,
      count: 1,
    });
  });
});

describe("guest cookies: 20 per hour per address", () => {
  it("the 21st new guest from one address is refused, other addresses are not", async () => {
    const ip = "203.0.113.7";
    for (let i = 1; i <= 20; i++) {
      request.cookies.clear();
      from(ip);
      expect(await saveGuestNameAction(null, form({ name: `Guest ${i}` }))).toEqual({ ok: true });
    }
    request.cookies.clear();
    from(ip);
    expect(await saveGuestNameAction(null, form({ name: "Guest 21" }))).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(request.cookies.has(GUEST_COOKIE)).toBe(false);

    from("198.51.100.4");
    expect(await saveGuestNameAction(null, form({ name: "Elsewhere" }))).toEqual({ ok: true });

    // Keys are salted hashes: the table never holds the address.
    expect(await bucketCount(rateLimitKey("guest-cookie", ip))).toBe(21);
    const keys = (await prisma.rateLimit.findMany({ select: { key: true } })).map((r) => r.key);
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  it("renaming an existing guest is not a new cookie and is not counted", async () => {
    const ip = "203.0.113.8";
    from(ip);
    expect(await saveGuestNameAction(null, form({ name: "First" }))).toEqual({ ok: true });
    const gid = await guestId();
    for (let i = 0; i < 25; i++) {
      expect(await saveGuestNameAction(null, form({ name: `Name ${i}` }))).toEqual({ ok: true });
    }
    expect(await guestId()).toBe(gid);
    expect(await bucketCount(rateLimitKey("guest-cookie", ip))).toBe(1);
  });

  it("does not throttle the `local` sentinel (no proxy header) outside production", async () => {
    for (let i = 0; i < 25; i++) {
      request.cookies.clear();
      from();
      expect(await saveGuestNameAction(null, form({ name: `Local ${i}` }))).toEqual({ ok: true });
    }
    expect(await bucketCount(rateLimitKey("guest-cookie", LOCAL_CLIENT))).toBeUndefined();
  });
});

describe("room creation: 10 per hour per identity and per address", () => {
  it("the 11th room of one guest is refused, whatever the address", async () => {
    from("192.0.2.1");
    expect(await createRoomAction(null, form({ locale: "fr", name: "Host" }))).toEqual({
      ok: true,
    });
    const gid = await guestId();
    for (let i = 2; i <= 10; i++) {
      from(`192.0.2.${i}`);
      expect(await createRoomAction(null, form({ locale: "fr" }))).toEqual({ ok: true });
    }
    from("192.0.2.11");
    expect(await createRoomAction(null, form({ locale: "fr" }))).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(rooms.createRoom).toHaveBeenCalledTimes(10);
    expect(await bucketCount(rateLimitKey("room-create", identityKey("guest", gid)))).toBe(11);
  });

  it("the 11th room from one address is refused, whoever asks", async () => {
    const ip = "192.0.2.200";
    for (let i = 1; i <= 10; i++) {
      request.cookies.clear();
      from(ip);
      expect(await createRoomAction(null, form({ locale: "en", name: `Host ${i}` }))).toEqual({
        ok: true,
      });
    }
    request.cookies.clear();
    from(ip);
    expect(await createRoomAction(null, form({ locale: "en", name: "Host 11" }))).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(rooms.createRoom).toHaveBeenCalledTimes(10);
    expect(await bucketCount(rateLimitKey("room-create-ip", ip))).toBe(11);
  });

  it("counts an account's rooms under its identity", async () => {
    const displayName = "Rosalind";
    const { id } = await prisma.user.create({
      data: {
        email: `rosalind-${crypto.randomUUID()}@example.test`,
        displayName,
        displayNameKey: nameKey(displayName),
        ageConfirmedAt: new Date(),
      },
      select: { id: true },
    });
    request.cookies.set(
      SESSION_COOKIE_NAME,
      await mintSessionToken(
        { id, sessionVersion: 0 },
        { secret: process.env.AUTH_SECRET as string, cookieName: SESSION_COOKIE_NAME },
      ),
    );
    for (let i = 1; i <= 10; i++) {
      from(`198.51.100.${100 + i}`);
      expect(await createRoomAction(null, form({ locale: "fr" }))).toEqual({ ok: true });
    }
    from("198.51.100.200");
    expect(await createRoomAction(null, form({ locale: "fr" }))).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(await bucketCount(rateLimitKey("room-create", identityKey("user", id)))).toBe(11);
  });

  it("does not throttle the `local` sentinel per address outside production", async () => {
    for (let i = 1; i <= 12; i++) {
      request.cookies.clear();
      from();
      expect(await createRoomAction(null, form({ locale: "fr", name: `Local ${i}` }))).toEqual({
        ok: true,
      });
    }
    expect(await bucketCount(rateLimitKey("room-create-ip", LOCAL_CLIENT))).toBeUndefined();
  });
});
