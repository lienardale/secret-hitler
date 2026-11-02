/**
 * The room's player-menu actions (real Postgres): report and block from a
 * room. The rooms Worker (`@/lib/rooms/api`), the session and the request
 * headers are mocked; the rate limits and the Block rows are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { rateLimitKey } from "@/lib/security/db-rate-limit";

import { createAccount } from "../_fixtures/game-result";

const mocks = vi.hoisted(() => {
  class RoomsUnavailableError extends Error {
    constructor(detail: string) {
      super(`rooms Worker unavailable: ${detail}`);
      this.name = "RoomsUnavailableError";
    }
  }
  return {
    RoomsUnavailableError,
    reportToRoom: vi.fn(),
    roomMember: vi.fn(),
    getCurrentUser: vi.fn(),
    origin: { value: "http://localhost:3000" as string | null },
  };
});

vi.mock("@/lib/rooms/api", () => ({
  RoomsUnavailableError: mocks.RoomsUnavailableError,
  reportToRoom: mocks.reportToRoom,
  roomMember: mocks.roomMember,
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isOnboarded: (user: { onboarded: boolean; displayName: string | null } | null) =>
    user !== null && user.onboarded && user.displayName !== null,
}));
vi.mock("next/headers", () => ({
  headers: async () => {
    const headers = new Headers({ host: "localhost:3000" });
    if (mocks.origin.value) headers.set("origin", mocks.origin.value);
    return headers;
  },
}));

const { blockFromRoomAction, reportPlayerAction } =
  await import("@/app/[locale]/salle/[code]/actions");

const CODE = "BCDFG";

/** Signs `id` in as an onboarded account (or `onboarded: false`). */
function signIn(id: string, name: string, onboarded = true) {
  mocks.getCurrentUser.mockResolvedValue({
    id,
    email: `${id}@example.test`,
    displayName: onboarded ? name : null,
    role: "USER",
    locale: "fr",
    emailVerified: true,
    hasPassword: true,
    onboarded,
    displayNameChangedAt: null,
  });
}

beforeEach(() => {
  mocks.reportToRoom.mockReset();
  mocks.roomMember.mockReset();
  mocks.getCurrentUser.mockReset();
  mocks.getCurrentUser.mockResolvedValue(null);
  mocks.origin.value = "http://localhost:3000";
});

describe("reportPlayerAction", () => {
  it("asks the room to report the member, as the signed-in account, with a fresh report id", async () => {
    const ada = await createAccount("Ada Report");
    signIn(ada, "Ada Report");
    mocks.reportToRoom.mockResolvedValue({ ok: true });

    expect(await reportPlayerAction(CODE, "abcd2345", "harassment", "  insults  ")).toEqual({
      ok: true,
    });
    expect(await reportPlayerAction(CODE, "abcd2345", "other", "")).toEqual({ ok: true });

    expect(mocks.reportToRoom).toHaveBeenCalledTimes(2);
    const [code, request] = mocks.reportToRoom.mock.calls[0] as [string, Record<string, string>];
    expect(code).toBe(CODE);
    expect(request).toEqual({
      reportId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      reporter: `u:${ada}`,
      target: "abcd2345",
      reason: "harassment",
      details: "insults",
    });
    const second = mocks.reportToRoom.mock.calls[1]?.[1] as { reportId: string };
    expect(second.reportId).not.toBe(request.reportId);
  });

  it("refuses other origins and visitors without an onboarded account, echoing what was typed", async () => {
    mocks.origin.value = "https://evil.example";
    const ada = await createAccount("Ada Origin");
    signIn(ada, "Ada Origin");
    expect(await reportPlayerAction(CODE, "abcd2345", "spam", "flood")).toEqual({
      ok: false,
      error: "forbidden",
      values: { reason: "spam", details: "flood" },
    });

    mocks.origin.value = "http://localhost:3000";
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await reportPlayerAction(CODE, "abcd2345", "spam", "flood")).toMatchObject({
      ok: false,
      error: "account_required",
    });
    signIn(ada, "Ada Origin", false);
    expect(await reportPlayerAction(CODE, "abcd2345", "spam", "flood")).toMatchObject({
      ok: false,
      error: "account_required",
    });
    expect(mocks.reportToRoom).not.toHaveBeenCalled();
  });

  it("refuses invalid input before counting it", async () => {
    const ada = await createAccount("Ada Input");
    signIn(ada, "Ada Input");
    const long = "x".repeat(501);
    const cases: [code: string, pid: string, reason: string, details: string][] = [
      ["bcdfg!", "abcd2345", "spam", ""],
      [CODE, "", "spam", ""],
      [CODE, "abcd 2345", "spam", ""],
      [CODE, "abcd2345", "rude", ""],
      [CODE, "abcd2345", "spam", long],
    ];
    for (const args of cases) {
      expect(await reportPlayerAction(...args)).toMatchObject({ ok: false, error: "invalid" });
    }
    expect(mocks.reportToRoom).not.toHaveBeenCalled();
    expect(
      await prisma.rateLimit.findUnique({ where: { key: rateLimitKey("report", ada) } }),
    ).toBeNull();
  });

  it("allows 10 reports per hour per account: the 11th is refused", async () => {
    const ada = await createAccount("Ada Limit");
    const bob = await createAccount("Bob Limit");
    mocks.reportToRoom.mockResolvedValue({ ok: true });
    signIn(ada, "Ada Limit");
    for (let i = 0; i < 10; i++) {
      expect(await reportPlayerAction(CODE, "abcd2345", "spam", `n${i}`)).toEqual({ ok: true });
    }
    expect(await reportPlayerAction(CODE, "abcd2345", "spam", "eleventh")).toEqual({
      ok: false,
      error: "rate_limited",
      values: { reason: "spam", details: "eleventh" },
    });
    expect(mocks.reportToRoom).toHaveBeenCalledTimes(10);

    // Another account has its own budget.
    signIn(bob, "Bob Limit");
    expect(await reportPlayerAction(CODE, "abcd2345", "spam", "")).toEqual({ ok: true });
  });

  it("maps the room's refusals and an unreachable Worker to message keys", async () => {
    const ada = await createAccount("Ada Errors");
    signIn(ada, "Ada Errors");
    for (const error of ["not_member", "unknown_target", "self", "guest_target", "no_room"]) {
      mocks.reportToRoom.mockResolvedValueOnce({ ok: false, error });
      expect(await reportPlayerAction(CODE, "abcd2345", "name", "rude name")).toEqual({
        ok: false,
        error,
        values: { reason: "name", details: "rude name" },
      });
    }
    mocks.reportToRoom.mockRejectedValueOnce(new mocks.RoomsUnavailableError("timeout"));
    expect(await reportPlayerAction(CODE, "abcd2345", "name", "")).toMatchObject({
      ok: false,
      error: "unavailable",
    });
  });
});

describe("blockFromRoomAction", () => {
  async function blocks(blockerId: string) {
    return prisma.block.findMany({ where: { blockerId }, select: { blockedId: true } });
  }

  it("blocks the account behind the room id (twice is harmless)", async () => {
    const ada = await createAccount("Ada Block");
    const bob = await createAccount("Bob Block");
    signIn(ada, "Ada Block");
    mocks.roomMember.mockResolvedValue({
      ok: true,
      member: { kind: "user", sub: bob, name: "Bob Block" },
    });

    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({ ok: true, already: false });
    expect(mocks.roomMember).toHaveBeenCalledWith(CODE, { requester: `u:${ada}`, pid: "abcd2345" });
    expect(await blocks(ada)).toEqual([{ blockedId: bob }]);
    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({ ok: true, already: true });
    expect(await blocks(ada)).toHaveLength(1);
  });

  it("never blocks a guest, nor oneself", async () => {
    const ada = await createAccount("Ada Guest");
    signIn(ada, "Ada Guest");
    mocks.roomMember.mockResolvedValueOnce({
      ok: true,
      member: { kind: "guest", sub: "0f8b1a2c-guest", name: "Invité" },
    });
    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({
      ok: false,
      error: "guest_target",
    });
    mocks.roomMember.mockResolvedValueOnce({
      ok: true,
      member: { kind: "user", sub: ada, name: "Ada Guest" },
    });
    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({ ok: false, error: "self" });
    expect(await blocks(ada)).toEqual([]);
  });

  it("maps the room's answers, a deleted account and an unreachable Worker", async () => {
    const ada = await createAccount("Ada Map");
    signIn(ada, "Ada Map");
    for (const error of ["no_room", "unknown_target", "not_member"] as const) {
      mocks.roomMember.mockResolvedValueOnce({ ok: false, error });
      expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({ ok: false, error });
    }
    mocks.roomMember.mockResolvedValueOnce({
      ok: true,
      member: { kind: "user", sub: crypto.randomUUID(), name: "Gone" },
    });
    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({
      ok: false,
      error: "unknown_target",
    });
    mocks.roomMember.mockRejectedValueOnce(new mocks.RoomsUnavailableError("timeout"));
    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await blocks(ada)).toEqual([]);
  });

  it("needs a same-origin onboarded account and valid input, and is rate limited (30 per hour)", async () => {
    const ada = await createAccount("Ada Gate");
    const bob = await createAccount("Bob Gate");

    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({
      ok: false,
      error: "account_required",
    });
    signIn(ada, "Ada Gate");
    mocks.origin.value = null;
    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({ ok: false, error: "forbidden" });
    mocks.origin.value = "http://localhost:3000";
    expect(await blockFromRoomAction("AEIOU", "abcd2345")).toEqual({ ok: false, error: "invalid" });
    expect(mocks.roomMember).not.toHaveBeenCalled();

    mocks.roomMember.mockResolvedValue({
      ok: true,
      member: { kind: "user", sub: bob, name: "Bob Gate" },
    });
    for (let i = 0; i < 30; i++) {
      expect(await blockFromRoomAction(CODE, "abcd2345")).toMatchObject({ ok: true });
    }
    expect(await blockFromRoomAction(CODE, "abcd2345")).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(mocks.roomMember).toHaveBeenCalledTimes(30);
  });
});
