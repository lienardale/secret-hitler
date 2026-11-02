/**
 * Profile management (real Postgres): renames (30 days, taken names,
 * onboarding not counted), blocks by name (case and accents, self, twice,
 * unknown), unblock, and account deletion anonymising the game history.
 */
import { nameKey } from "@sh/protocol";
import { describe, expect, it } from "vitest";

import { RENAME_INTERVAL_MS } from "@/lib/auth/display-name";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { userGameHistory } from "@/lib/games/history";
import { ingestGameResult } from "@/lib/games/ingest";
import { MAX_BLOCK_KEYS } from "@/lib/players/blocks";
import {
  blockByName,
  blockUser,
  deleteAccount,
  listBlocked,
  renameAccount,
  unblock,
} from "@/lib/players/manage";

import { createAccount, gameResult } from "../_fixtures/game-result";

const PASSWORD = "four random winter tables";
const DAY = 24 * 60 * 60_000;

async function accountWithPassword(displayName: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${nameKey(displayName).replace(/[^a-z0-9]/g, "-")}-${crypto.randomUUID()}@example.test`,
      passwordHash: await hashPassword(PASSWORD),
      displayName,
      displayNameKey: nameKey(displayName),
      ageConfirmedAt: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

async function row(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { displayName: true, displayNameKey: true, displayNameChangedAt: true },
  });
}

describe("renameAccount", () => {
  it("the name chosen at sign-up does not count: the first rename is allowed, the next one 30 days later", async () => {
    const id = await createAccount("Rosalind");
    const now = new Date("2026-11-02T12:00:00Z");

    expect(await renameAccount(prisma, id, "  Rosalind   F ", now)).toEqual({
      ok: true,
      name: "Rosalind F",
    });
    expect(await row(id)).toEqual({
      displayName: "Rosalind F",
      displayNameKey: "rosalind f",
      displayNameChangedAt: now,
    });

    const soon = new Date(now.getTime() + 29 * DAY);
    expect(await renameAccount(prisma, id, "Rosa", soon)).toEqual({
      ok: false,
      error: "renameTooSoon",
      nextAt: new Date(now.getTime() + RENAME_INTERVAL_MS),
    });
    expect((await row(id))?.displayName).toBe("Rosalind F");

    const later = new Date(now.getTime() + RENAME_INTERVAL_MS);
    expect(await renameAccount(prisma, id, "Rosa", later)).toEqual({ ok: true, name: "Rosa" });
    expect((await row(id))?.displayNameChangedAt).toEqual(later);
  });

  it("refuses taken names (case and accents ignored), invalid names and the same name", async () => {
    await createAccount("Hélène");
    const id = await createAccount("Barbara");
    for (const taken of ["Hélène", "HELENE", "helene"]) {
      expect(await renameAccount(prisma, id, taken)).toEqual({ ok: false, error: "nameTaken" });
    }
    expect(await renameAccount(prisma, id, "B")).toEqual({ ok: false, error: "name_length" });
    expect(await renameAccount(prisma, id, "-Barb")).toEqual({
      ok: false,
      error: "name_characters",
    });
    expect(await renameAccount(prisma, id, "Modérateur")).toEqual({
      ok: false,
      error: "name_reserved",
    });
    expect(await renameAccount(prisma, id, "Barbara")).toEqual({ ok: false, error: "sameName" });
    // None of these used up the rename.
    expect((await row(id))?.displayNameChangedAt).toBeNull();
    // Changing only the case of one's own name is a rename.
    expect(await renameAccount(prisma, id, "BARBARA")).toEqual({ ok: true, name: "BARBARA" });
  });

  it("two renames at once: only one goes through", async () => {
    const id = await createAccount("Mary");
    const results = await Promise.all([
      renameAccount(prisma, id, "Mary One"),
      renameAccount(prisma, id, "Mary Two"),
      renameAccount(prisma, id, "Mary Three"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error)).toEqual([
      "renameTooSoon",
      "renameTooSoon",
    ]);
  });

  it("an unknown account", async () => {
    expect(await renameAccount(prisma, crypto.randomUUID(), "Nobody")).toEqual({
      ok: false,
      error: "accountNotFound",
    });
    expect(await renameAccount(prisma, "not-a-uuid", "Nobody")).toEqual({
      ok: false,
      error: "accountNotFound",
    });
  });
});

describe("blocks", () => {
  it("blocks by name ignoring case and accents; twice is harmless", async () => {
    const me = await createAccount("Joan");
    const target = await createAccount("Éléonore");

    expect(await blockByName(prisma, me, "  ELEONORE ")).toEqual({
      ok: true,
      name: "Éléonore",
      already: false,
    });
    expect(await blockByName(prisma, me, "éléonore")).toEqual({
      ok: true,
      name: "Éléonore",
      already: true,
    });
    expect(await blockUser(prisma, me, target)).toEqual({
      ok: true,
      name: "Éléonore",
      already: true,
    });
    expect(await prisma.block.count({ where: { blockerId: me } })).toBe(1);
  });

  it("refuses yourself and unknown names", async () => {
    const me = await createAccount("Lise");
    expect(await blockByName(prisma, me, "LISE")).toEqual({ ok: false, error: "blockSelf" });
    expect(await blockUser(prisma, me, me)).toEqual({ ok: false, error: "blockSelf" });
    expect(await blockByName(prisma, me, "Nobody Here")).toEqual({
      ok: false,
      error: "playerNotFound",
    });
    expect(await blockByName(prisma, me, "x")).toEqual({ ok: false, error: "playerNotFound" });
    expect(await blockByName(prisma, me, "y".repeat(200))).toEqual({
      ok: false,
      error: "playerNotFound",
    });
    expect(await blockByName(prisma, me, 42)).toEqual({ ok: false, error: "playerNotFound" });
    expect(await blockUser(prisma, me, crypto.randomUUID())).toEqual({
      ok: false,
      error: "playerNotFound",
    });
    expect(await blockUser(prisma, me, "not-a-uuid")).toEqual({
      ok: false,
      error: "playerNotFound",
    });
    expect(await prisma.block.count({ where: { blockerId: me } })).toBe(0);
  });

  it("lists blocked players newest first with their current names; unblock removes one", async () => {
    const me = await createAccount("Dorothy");
    const first = await createAccount("First");
    const second = await createAccount("Second");
    await prisma.block.createMany({
      data: [
        { blockerId: me, blockedId: first, createdAt: new Date("2026-10-01T00:00:00Z") },
        { blockerId: me, blockedId: second, createdAt: new Date("2026-10-02T00:00:00Z") },
        { blockerId: second, blockedId: me },
      ],
    });
    await prisma.user.update({ where: { id: first }, data: { displayName: "First Renamed" } });

    expect(await listBlocked(prisma, me)).toEqual([
      { userId: second, name: "Second", blockedAt: new Date("2026-10-02T00:00:00Z") },
      { userId: first, name: "First Renamed", blockedAt: new Date("2026-10-01T00:00:00Z") },
    ]);

    expect(await unblock(prisma, me, second)).toBe(true);
    expect(await unblock(prisma, me, second)).toBe(false);
    expect(await unblock(prisma, me, "not-a-uuid")).toBe(false);
    expect((await listBlocked(prisma, me)).map((b) => b.userId)).toEqual([first]);
    // Unblocking never touches the other direction.
    expect(await prisma.block.count({ where: { blockerId: second, blockedId: me } })).toBe(1);
  });

  it(`stops at ${MAX_BLOCK_KEYS} blocked players`, async () => {
    const me = await createAccount("Collector");
    const others = await prisma.user.createManyAndReturn({
      data: Array.from({ length: MAX_BLOCK_KEYS + 1 }, (_, i) => ({
        email: `blocked-${i}-${crypto.randomUUID()}@example.test`,
        displayName: `Blocked ${i}`,
        displayNameKey: `blocked ${i}`,
      })),
      select: { id: true },
    });
    await prisma.block.createMany({
      data: others.slice(0, MAX_BLOCK_KEYS).map((o) => ({ blockerId: me, blockedId: o.id })),
    });
    expect(await blockByName(prisma, me, `Blocked ${MAX_BLOCK_KEYS}`)).toEqual({
      ok: false,
      error: "tooManyBlocks",
    });
    // Someone already blocked still answers "already".
    expect(await blockByName(prisma, me, "Blocked 0")).toEqual({
      ok: true,
      name: "Blocked 0",
      already: true,
    });
  });
});

describe("deleteAccount", () => {
  it("anonymises the history: the game stays for the others, with a deleted player in that seat", async () => {
    const ada = await accountWithPassword("Ada");
    const bob = await createAccount("Bob");
    const payload = gameResult({ users: { 0: ada, 1: bob }, players: 5 });
    await ingestGameResult(payload);
    await prisma.block.createMany({
      data: [
        { blockerId: ada, blockedId: bob },
        { blockerId: bob, blockedId: ada },
      ],
    });
    expect((await userGameHistory(bob))[0]?.others[0]).toMatchObject({
      seat: 0,
      name: "Ada",
      userId: ada,
    });

    expect(await deleteAccount(prisma, ada, { password: "wrong password here" })).toEqual({
      ok: false,
      error: "wrongPassword",
    });
    expect(await deleteAccount(prisma, ada, { displayName: "Ada" })).toEqual({
      ok: false,
      error: "wrongPassword",
    });
    expect(await prisma.user.count({ where: { id: ada } })).toBe(1);

    expect(await deleteAccount(prisma, ada, { password: PASSWORD })).toEqual({ ok: true });

    expect(await prisma.user.count({ where: { id: ada } })).toBe(0);
    const history = await userGameHistory(bob);
    expect(history.map((g) => g.id)).toEqual([payload.gameId]);
    expect(history[0]?.others[0]).toMatchObject({ seat: 0, name: null, userId: null });
    expect(
      await prisma.gamePlayer.findUnique({
        where: { gameId_seat: { gameId: payload.gameId, seat: 0 } },
        select: { kind: true, userId: true, name: true },
      }),
    ).toEqual({ kind: "user", userId: null, name: null });
    // Bob's own seat is untouched.
    expect(
      (
        await prisma.gamePlayer.findUnique({
          where: { gameId_seat: { gameId: payload.gameId, seat: 1 } },
        })
      )?.userId,
    ).toBe(bob);
    expect(
      await prisma.block.count({ where: { OR: [{ blockerId: ada }, { blockedId: ada }] } }),
    ).toBe(0);
    expect(await deleteAccount(prisma, ada, { password: PASSWORD })).toEqual({
      ok: false,
      error: "accountNotFound",
    });
  });

  it("an account without a password confirms with its display name (case and accents ignored)", async () => {
    const id = await createAccount("Émilie");
    await prisma.emailToken.create({
      data: {
        userId: id,
        purpose: "VERIFY_EMAIL",
        tokenHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    await prisma.account.create({
      data: {
        userId: id,
        type: "oidc",
        provider: "google",
        providerAccountId: `g-${crypto.randomUUID()}`,
      },
    });

    expect(await deleteAccount(prisma, id, { displayName: "Emily" })).toEqual({
      ok: false,
      error: "wrongName",
    });
    expect(await deleteAccount(prisma, id, { displayName: "" })).toEqual({
      ok: false,
      error: "wrongName",
    });
    expect(await deleteAccount(prisma, id, { password: "anything" })).toEqual({
      ok: false,
      error: "wrongName",
    });
    expect(await deleteAccount(prisma, id, { displayName: " EMILIE " })).toEqual({ ok: true });

    expect(await prisma.user.count({ where: { id } })).toBe(0);
    expect(await prisma.emailToken.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: id } })).toBe(0);
  });
});
