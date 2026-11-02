import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signRequest, verifyRequest } from "../src";
import { HMAC_VECTOR } from "./vectors";

const secret = HMAC_VECTOR.secret;
const parts = { method: "POST", path: "/internal/rooms", body: '{"a":1}' };
const now = 1_800_000_000_000;

describe("signed requests", () => {
  it("matches the shared test vector (also checked inside workerd)", async () => {
    expect(await signRequest(secret, HMAC_VECTOR.parts, HMAC_VECTOR.now)).toBe(HMAC_VECTOR.header);
  });

  it("agrees with node:crypto", async () => {
    const t = Math.floor(now / 1000);
    const expected = createHmac("sha256", secret)
      .update(`${t}\nPOST\n/internal/rooms\n{"a":1}`)
      .digest("hex");
    expect(await signRequest(secret, parts, now)).toBe(`t=${t},v1=${expected}`);
  });

  it("verifies its own signatures", async () => {
    const header = await signRequest(secret, parts, now);
    expect(await verifyRequest(secret, parts, header, now)).toBe(true);
    expect(await verifyRequest(secret, { ...parts, method: "post" }, header, now)).toBe(true);
  });

  it("refuses a changed body, path, method or secret", async () => {
    const header = await signRequest(secret, parts, now);
    expect(await verifyRequest(secret, { ...parts, body: '{"a":2}' }, header, now)).toBe(false);
    expect(await verifyRequest(secret, { ...parts, path: "/internal/x" }, header, now)).toBe(false);
    expect(await verifyRequest(secret, { ...parts, method: "GET" }, header, now)).toBe(false);
    expect(await verifyRequest(`${secret}!`, parts, header, now)).toBe(false);
  });

  it("refuses signatures outside the 5 minute window", async () => {
    const header = await signRequest(secret, parts, now);
    expect(await verifyRequest(secret, parts, header, now + 299_000)).toBe(true);
    expect(await verifyRequest(secret, parts, header, now + 301_000)).toBe(false);
    expect(await verifyRequest(secret, parts, header, now - 301_000)).toBe(false);
  });

  it("refuses missing or malformed headers", async () => {
    expect(await verifyRequest(secret, parts, null, now)).toBe(false);
    expect(await verifyRequest(secret, parts, "garbage", now)).toBe(false);
    expect(await verifyRequest(secret, parts, `t=1,v1=${"0".repeat(63)}`, now)).toBe(false);
  });

  it("refuses short secrets", async () => {
    await expect(signRequest("short", parts, now)).rejects.toThrow(/at least 32/);
  });
});
