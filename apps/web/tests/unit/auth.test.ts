import { describe, expect, it, vi } from "vitest";

import { authorizeCredentials, type CredentialsUserStore } from "@/lib/auth/authorize";
import { nextRenameAt, validateDisplayName, RENAME_INTERVAL_MS } from "@/lib/auth/display-name";
import { authErrorKey, RateLimitedSignin, signInFailure } from "@/lib/auth/errors";
import { checkPassword } from "@/lib/auth/password-policy";
import { safeCallbackUrl } from "@/lib/auth/safe-callback-url";
import {
  decodeSessionToken,
  mintSessionToken,
  presentSessionCookie,
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  withoutSessionWrites,
} from "@/lib/auth/session-token";
import { hashToken } from "@/lib/auth/verification";
import type { DbRateLimiter } from "@/lib/security/db-rate-limit";

const SECRET = "test-auth-secret-0123456789abcdefghijklmnop";
const USER_ID = "3f1c2a8e-5b7d-4c1e-9a2f-0d4b6e8c1a3f";

function limiter(refuse: Set<number> = new Set()): DbRateLimiter & { calls: number } {
  const state = {
    calls: 0,
    async consume() {
      state.calls += 1;
      return refuse.has(state.calls)
        ? { ok: false, retryAfterMs: 90_000, count: 99 }
        : { ok: true, retryAfterMs: 0, count: state.calls };
    },
    reset: vi.fn(async () => undefined),
  };
  return state;
}

function store(row: Awaited<ReturnType<CredentialsUserStore["user"]["findUnique"]>>) {
  return {
    user: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async () => undefined),
    },
  } satisfies CredentialsUserStore;
}

const deps = (prisma: CredentialsUserStore, rateLimiter = limiter()) => ({
  prisma,
  rateLimiter,
  ip: "203.0.113.7",
  isProduction: true,
  sleep: async () => undefined,
  verify: async (password: string, hash: string | null | undefined) => hash === `hash:${password}`,
  hash: async (password: string) => `hash:${password}`,
});

describe("authorizeCredentials", () => {
  const row = {
    id: USER_ID,
    email: "ada@example.org",
    sessionVersion: 3,
    passwordHash: "hash:correct horse",
  };

  it("signs in with the right password and normalises the address", async () => {
    const prisma = store(row);
    const user = await authorizeCredentials(
      { email: " ADA@Example.org ", password: "correct horse" },
      deps(prisma),
    );
    expect(user).toEqual({ id: USER_ID, email: "ada@example.org", sessionVersion: 3 });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "ada@example.org" } }),
    );
  });

  it("answers null for a wrong password, an unknown address and a Google-only account alike", async () => {
    expect(
      await authorizeCredentials({ email: "ada@example.org", password: "nope" }, deps(store(row))),
    ).toBeNull();
    expect(
      await authorizeCredentials({ email: "x@example.org", password: "nope" }, deps(store(null))),
    ).toBeNull();
    expect(
      await authorizeCredentials(
        { email: "ada@example.org", password: "correct horse" },
        deps(store({ ...row, passwordHash: null })),
      ),
    ).toBeNull();
  });

  it("refuses malformed credentials before touching anything", async () => {
    const prisma = store(row);
    expect(await authorizeCredentials({ email: "", password: "x" }, deps(prisma))).toBeNull();
    expect(await authorizeCredentials("nope", deps(prisma))).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("throws RateLimitedSignin when the per-address bucket is full", async () => {
    await expect(
      authorizeCredentials(
        { email: "ada@example.org", password: "correct horse" },
        deps(store(row), limiter(new Set([1]))),
      ),
    ).rejects.toBeInstanceOf(RateLimitedSignin);
  });

  it("only delays (never refuses) when the per-account bucket is full", async () => {
    const sleep = vi.fn(async () => undefined);
    const user = await authorizeCredentials(
      { email: "ada@example.org", password: "correct horse" },
      { ...deps(store(row), limiter(new Set([3]))), sleep },
    );
    expect(user?.id).toBe(USER_ID);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("clears the (address, account) bucket after a good sign-in", async () => {
    const rateLimiter = limiter();
    await authorizeCredentials(
      { email: "ada@example.org", password: "correct horse" },
      deps(store(row), rateLimiter),
    );
    expect(rateLimiter.reset).toHaveBeenCalledOnce();
  });
});

describe("sign-in failures", () => {
  it("maps credential and rate-limit errors, and nothing else", () => {
    expect(signInFailure(new RateLimitedSignin(61_000))).toEqual({
      kind: "rate_limited",
      retryAfterSec: 61,
    });
    expect(signInFailure({ type: "CredentialsSignin" })).toEqual({ kind: "invalid" });
    expect(signInFailure({ cause: { err: new RateLimitedSignin(1000) } })).toMatchObject({
      kind: "rate_limited",
    });
    expect(signInFailure(new Error("boom"))).toBeNull();
  });

  it("maps Auth.js ?error= values to message keys", () => {
    expect(authErrorKey("OAuthAccountNotLinked")).toBe("oauthAccountNotLinked");
    expect(authErrorKey("SomethingNew")).toBe("authFailed");
    expect(authErrorKey("constructor")).toBe("authFailed");
    expect(authErrorKey(null)).toBeNull();
  });
});

describe("safeCallbackUrl", () => {
  it.each([
    ["/fr/salle/BCDFG", "/fr/salle/BCDFG"],
    ["/en/play?x=1#frag", "/en/play?x=1"],
    ["https://evil.example", "/fr"],
    ["//evil.example", "/fr"],
    ["/\\evil.example", "/fr"],
    ["/%2F%2Fevil.example", "/fr"],
    ["javascript:alert(1)", "/fr"],
    ["/api/auth/signout", "/fr"],
    ["profil", "/fr"],
    ["/fr/a\nb", "/fr"],
  ])("%s → %s", (raw, expected) => {
    expect(safeCallbackUrl(raw, "fr")).toBe(expected);
  });
});

describe("password policy", () => {
  it("wants 10 characters, at most 72 bytes, nothing common, not the address", () => {
    expect(checkPassword("short")).toBe("tooShort");
    expect(checkPassword("é".repeat(40))).toBe("tooLong");
    expect(checkPassword("1234567890")).toBe("tooCommon");
    expect(checkPassword("ada-lovelace-1815", { email: "ada-lovelace@example.org" })).toBe(
      "matchesEmail",
    );
    expect(checkPassword("four random winter tables")).toBeNull();
  });
});

describe("display names", () => {
  it("normalises, checks the shape and derives the uniqueness key", () => {
    expect(validateDisplayName("  Élise  Martin ")).toEqual({
      ok: true,
      name: "Élise Martin",
      key: "elise martin",
    });
    expect(validateDisplayName("x")).toEqual({ ok: false, error: "name_length" });
    expect(validateDisplayName("Admin")).toEqual({ ok: false, error: "name_reserved" });
    expect(validateDisplayName(42)).toEqual({ ok: false, error: "name_length" });
  });

  it("allows one rename per 30 days", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(nextRenameAt(null, now)).toBeNull();
    expect(nextRenameAt(new Date(now.getTime() - RENAME_INTERVAL_MS - 1), now)).toBeNull();
    expect(nextRenameAt(new Date(now.getTime() - 1000), now)?.getTime()).toBe(
      now.getTime() - 1000 + RENAME_INTERVAL_MS,
    );
  });
});

describe("session tokens", () => {
  it("round-trips id and sessionVersion under the cookie's own salt", async () => {
    const token = await mintSessionToken(
      { id: USER_ID, sessionVersion: 4 },
      { secret: SECRET, cookieName: SESSION_COOKIE_NAME },
    );
    expect(
      await decodeSessionToken(token, { secret: SECRET, cookieName: SESSION_COOKIE_NAME }),
    ).toEqual({
      id: USER_ID,
      sessionVersion: 4,
    });
    // Another salt (the secure name) or another secret does not decode.
    expect(
      await decodeSessionToken(token, { secret: SECRET, cookieName: SECURE_SESSION_COOKIE_NAME }),
    ).toBeNull();
    expect(
      await decodeSessionToken(token, { secret: `${SECRET}x`, cookieName: SESSION_COOKIE_NAME }),
    ).toBeNull();
    expect(
      await decodeSessionToken("garbage", { secret: SECRET, cookieName: SESSION_COOKIE_NAME }),
    ).toBeNull();
  });

  it("prefers the secure cookie name", () => {
    expect(presentSessionCookie([SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME])).toBe(
      SECURE_SESSION_COOKIE_NAME,
    );
    expect(presentSessionCookie(["other"])).toBeNull();
  });

  it("strips session cookies (and only them) from a response", () => {
    const headers = new Headers();
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}=abc; Path=/`);
    headers.append("set-cookie", `${SESSION_COOKIE_NAME}.0=chunk; Path=/`);
    headers.append("set-cookie", "authjs.csrf-token=x; Path=/");
    const out = withoutSessionWrites(new Response("{}", { headers }));
    expect(out.headers.getSetCookie()).toEqual(["authjs.csrf-token=x; Path=/"]);
  });
});

describe("verification tokens", () => {
  it("are stored as a SHA-256 hex digest", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("Prisma error log filter", async () => {
  const { isExpectedUniqueLog, reportPrismaError } = await import("@/lib/db/log");
  const unique = (target: string, constraint: string) => ({
    target,
    message: `Invalid \`prisma.${target}()\` invocation:\n\n\nUnique constraint failed on the constraint: \`${constraint}\``,
  });

  it("drops only the unique violations the code answers, on their own call sites", () => {
    expect(isExpectedUniqueLog(unique("user.create", "User_displayName_key"))).toBe(true);
    expect(isExpectedUniqueLog(unique("game.create", "Game_pkey"))).toBe(true);
    expect(isExpectedUniqueLog(unique("user.update", "User_email_key"))).toBe(false);
    expect(isExpectedUniqueLog(unique("block.create", "Block_pkey"))).toBe(false);
    const lines: string[] = [];
    reportPrismaError(unique("gamePlayer.create", "GamePlayer_pkey"), (line) => lines.push(line));
    reportPrismaError(unique("user.create", "User_email_key"), (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[prisma\] gamePlayer\.create/);
  });
});
