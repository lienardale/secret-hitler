import { describe, expect, it } from "vitest";

import { isDisplayNameTaken, validateDisplayName } from "@/lib/auth/display-name";
import {
  consumeVerificationToken,
  createVerificationToken,
  VERIFICATION_TTL_MS,
} from "@/lib/auth/verification";
import { isUniqueViolation } from "@/lib/db/errors";
import { prisma } from "@/lib/db/prisma";
import { avoidKeys, blockedKeys } from "@/lib/players/blocks";

async function createUser(email: string, name: string) {
  const check = validateDisplayName(name);
  if (!check.ok) throw new Error(check.error);
  return prisma.user.create({
    data: { email, displayName: check.name, displayNameKey: check.key, ageConfirmedAt: new Date() },
  });
}

async function violation(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a unique violation");
}

describe("accounts (real Postgres)", () => {
  it("one account per e-mail address, whatever the case (citext)", async () => {
    await createUser("ada@example.org", "Ada");
    const error = await violation(createUser("ADA@Example.ORG", "Ada Two"));
    expect(isUniqueViolation(error, "email")).toBe(true);
    expect(isDisplayNameTaken(error)).toBe(false);
  });

  it("display names are unique ignoring case and accents", async () => {
    await createUser("elise@example.org", "Élise");
    for (const name of ["élise", "ELISE", "Elise"]) {
      const error = await violation(
        createUser(`${name.length}-${Math.random()}@example.org`, name),
      );
      expect(isDisplayNameTaken(error)).toBe(true);
    }
  });

  it("verification links work once, and not after 24 hours", async () => {
    const user = await createUser("grace@example.org", "Grace");
    const now = new Date();
    const first = await createVerificationToken(prisma, user.id, now);
    const second = await createVerificationToken(prisma, user.id, now);
    // A new link replaces the previous one.
    expect(await consumeVerificationToken(prisma, first, now)).toBeNull();
    expect(await consumeVerificationToken(prisma, second, now)).toBe(user.id);
    expect(await consumeVerificationToken(prisma, second, now)).toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified,
    ).not.toBeNull();

    const late = await createVerificationToken(prisma, user.id, now);
    expect(
      await consumeVerificationToken(
        prisma,
        late,
        new Date(now.getTime() + VERIFICATION_TTL_MS + 1),
      ),
    ).toBeNull();
    expect(await prisma.emailToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it("a verification link is single-use under a race", async () => {
    const user = await createUser("katherine@example.org", "Katherine");
    const token = await createVerificationToken(prisma, user.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeVerificationToken(prisma, token)),
    );
    expect(results.filter((id) => id === user.id)).toHaveLength(1);
  });

  it("blocks: tickets carry who I blocked, quick match avoids both directions", async () => {
    const [me, rude, wary, stranger] = await Promise.all([
      createUser("me@example.org", "Me"),
      createUser("rude@example.org", "Rude"),
      createUser("wary@example.org", "Wary"),
      createUser("stranger@example.org", "Stranger"),
    ]);
    await prisma.block.createMany({
      data: [
        { blockerId: me.id, blockedId: rude.id },
        { blockerId: wary.id, blockedId: me.id },
        { blockerId: stranger.id, blockedId: rude.id },
      ],
    });
    expect(await blockedKeys(prisma, me.id)).toEqual([`u:${rude.id}`]);
    expect((await avoidKeys(prisma, me.id)).sort()).toEqual(
      [`u:${rude.id}`, `u:${wary.id}`].sort(),
    );
  });

  it("deleting an account removes its blocks in both directions", async () => {
    const [a, b] = await Promise.all([
      createUser("a@example.org", "Anna"),
      createUser("b@example.org", "Bea"),
    ]);
    await prisma.block.createMany({
      data: [
        { blockerId: a.id, blockedId: b.id },
        { blockerId: b.id, blockedId: a.id },
      ],
    });
    await prisma.user.delete({ where: { id: a.id } });
    expect(
      await prisma.block.count({ where: { OR: [{ blockerId: a.id }, { blockedId: a.id }] } }),
    ).toBe(0);
  });
});
