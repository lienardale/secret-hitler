import { describe, expect, it } from "vitest";

import { clientIp } from "../../lib/security/client-ip";
import { isSameOrigin } from "../../lib/security/origin";
import { memoryRateLimiter } from "../../lib/security/rate-limit";

describe("same-origin check", () => {
  it("accepts a matching Origin and host (proxy host first)", () => {
    expect(
      isSameOrigin(new Headers({ origin: "http://localhost:3000", host: "localhost:3000" })),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Headers({
          origin: "https://sh.example",
          host: "internal:8080",
          "x-forwarded-host": "sh.example",
        }),
      ),
    ).toBe(true);
  });

  it("refuses a missing, foreign or malformed Origin", () => {
    expect(isSameOrigin(new Headers({ host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example", host: "sh.example" }))).toBe(
      false,
    );
    expect(
      isSameOrigin(new Headers({ origin: "http://localhost:3001", host: "localhost:3000" })),
    ).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "not a url", host: "sh.example" }))).toBe(false);
  });
});

describe("client IP bucket", () => {
  it.each([
    [{ "x-vercel-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }, "1.2.3.4"],
    [{ "x-real-ip": "5.6.7.8:5000" }, "5.6.7.8"],
    [{ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, "9.9.9.9"],
    [{ "x-real-ip": "::ffff:192.0.2.1" }, "192.0.2.1"],
    [{ "x-real-ip": "2001:db8:1:2:3:4:5:6" }, "2001:db8:1:2::/64"],
    [{ "x-real-ip": "[2001:db8:1:2::9]:443" }, "2001:db8:1:2::/64"],
    [{}, "local"],
  ])("%j → %s", (headers, bucket) => {
    expect(clientIp(new Headers(headers))).toBe(bucket);
  });
});

describe("memory rate limiter", () => {
  it("allows `limit` hits per window, then reports when to retry", () => {
    const limiter = memoryRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.take("a", 0).ok).toBe(true);
    expect(limiter.take("a", 100).ok).toBe(true);
    expect(limiter.take("a", 200)).toEqual({ ok: false, retryAfterMs: 800 });
    expect(limiter.take("b", 200).ok).toBe(true);
    expect(limiter.take("a", 1001).ok).toBe(true);
  });
});
