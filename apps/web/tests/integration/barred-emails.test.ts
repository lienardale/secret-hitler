/**
 * Deleting a suspended account does not lift the suspension (real Postgres):
 * its address is kept as a fingerprint until the suspension ends, and only
 * then may it sign up again. Accounts that are not suspended leave nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { barredEmailFingerprint, isEmailBarred } from "@/lib/moderation/barred-emails";
import { deleteAccount } from "@/lib/players/manage";

import { createAccount } from "../_fixtures/game-result";

const DAY = 86_400_000;

async function suspended(name: string, expiresAt: Date | null) {
  const id = await createAccount(name);
  await prisma.ban.create({ data: { userId: id, reason: "test", expiresAt } });
  const { email } = await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
  return { id, email, name };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "BarredEmail" CASCADE');
});

describe("barred e-mails", () => {
  it("bars the address of an account deleted while suspended, until the end", async () => {
    const end = new Date(Date.now() + 10 * DAY);
    const player = await suspended("Barred Ada", end);
    expect(await deleteAccount(prisma, player.id, { displayName: player.name })).toEqual({
      ok: true,
    });

    const row = await prisma.barredEmail.findUnique({
      where: { fingerprint: barredEmailFingerprint(player.email) },
    });
    expect(row?.until).toEqual(end);
    // Case and spaces do not matter, and the address itself is not stored.
    expect(await isEmailBarred(prisma, `  ${player.email.toUpperCase()} `)).toBe(true);
    expect(JSON.stringify(await prisma.barredEmail.findMany())).not.toContain(player.email);
    expect(await isEmailBarred(prisma, player.email, new Date(end.getTime() + 1))).toBe(false);
  });

  it("bars for good after a permanent suspension", async () => {
    const player = await suspended("Barred Basile", null);
    await deleteAccount(prisma, player.id, { displayName: player.name });
    expect(await isEmailBarred(prisma, player.email, new Date(Date.now() + 3650 * DAY))).toBe(true);
  });

  it("leaves nothing for an account that is not suspended (or no longer)", async () => {
    const free = await createAccount("Free Chloe");
    const lapsed = await suspended("Lapsed Dmitri", new Date(Date.now() - DAY));
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: free },
      select: { email: true },
    });
    await deleteAccount(prisma, free, { displayName: "Free Chloe" });
    await deleteAccount(prisma, lapsed.id, { displayName: lapsed.name });
    expect(await prisma.barredEmail.count()).toBe(0);
    expect(await isEmailBarred(prisma, email)).toBe(false);
  });

  it("writes nothing when the deletion is refused", async () => {
    const player = await suspended("Barred Elif", new Date(Date.now() + DAY));
    expect(await deleteAccount(prisma, player.id, { displayName: "someone else" })).toEqual({
      ok: false,
      error: "wrongName",
    });
    expect(await prisma.barredEmail.count()).toBe(0);
  });
});
