import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { createDbRateLimiter, rateLimitKey } from "@/lib/security/db-rate-limit";

describe("database rate limiter (real Postgres)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allows max hits per window, refuses the next, and reopens after the window", async () => {
    let now = Date.parse("2026-11-02T10:00:00Z");
    const limiter = createDbRateLimiter(prisma, () => now);
    const key = rateLimitKey("test", "window");
    const options = { max: 3, windowMs: 60_000 };

    for (let i = 1; i <= 3; i++) {
      expect(await limiter.consume(key, options)).toMatchObject({ ok: true, count: i });
    }
    const refused = await limiter.consume(key, options);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBe(60_000);

    now += 60_001;
    expect(await limiter.consume(key, options)).toMatchObject({ ok: true, count: 1 });
  });

  it("counts a concurrent burst exactly (each hit gets its own position)", async () => {
    const limiter = createDbRateLimiter(prisma);
    const key = rateLimitKey("test", "burst");
    const verdicts = await Promise.all(
      Array.from({ length: 12 }, () => limiter.consume(key, { max: 5, windowMs: 60_000 })),
    );
    expect(verdicts.filter((v) => v.ok)).toHaveLength(5);
    expect(verdicts.map((v) => v.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  it("keeps the expected conditional-update miss out of the logs, on every console channel", async () => {
    const lines: string[] = [];
    for (const channel of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    const limiter = createDbRateLimiter(prisma);
    await limiter.consume(rateLimitKey("test", "fresh-key"), { max: 5, windowMs: 60_000 });
    expect(lines.filter((line) => /required but not found/.test(line))).toEqual([]);
  });

  it("still prints a real Prisma error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      prisma.user.update({ where: { id: "00000000-0000-4000-8000-000000000000" }, data: {} }),
    ).rejects.toThrow();
    expect(
      error.mock.calls.some((call) => String(call[0]).startsWith("[prisma] user.update")),
    ).toBe(true);
  });
});
