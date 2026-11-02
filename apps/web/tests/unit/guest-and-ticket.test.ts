import { exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { importTicketPublicKey, verifyTicket } from "@sh/protocol";

import { EnvValidationError, parseEnv, testPagesEnabled } from "../../lib/env";
import { newGuestId, signGuest, verifyGuest } from "../../lib/guest/cookie";
import { guestTicketUrl, roomSocketUrl } from "../../lib/rooms/ticket";

const SECRET = "ci-dummy-guest-secret-0123456789abcdef";
const now = 1_800_000_000_000;

describe("guest cookie", () => {
  it("round-trips a guest", async () => {
    const guest = { gid: newGuestId(), name: "Ada" };
    expect(guest.gid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const token = await signGuest(guest, SECRET, now);
    expect(await verifyGuest(token, SECRET, now + 1000)).toEqual(guest);
  });

  it("refuses forged, expired, missing and malformed cookies", async () => {
    const token = await signGuest({ gid: newGuestId(), name: "Ada" }, SECRET, now);
    expect(await verifyGuest(token, `${SECRET}x`, now)).toBeNull();
    expect(await verifyGuest(token, SECRET, now + 31 * 24 * 3600 * 1000)).toBeNull();
    expect(await verifyGuest(undefined, SECRET, now)).toBeNull();
    expect(await verifyGuest("garbage", SECRET, now)).toBeNull();
    const badName = await signGuest({ gid: newGuestId(), name: "x" }, SECRET, now);
    expect(await verifyGuest(badName, SECRET, now)).toBeNull();
  });
});

describe("room tickets", () => {
  it("builds the WebSocket URL for the rooms host", () => {
    expect(roomSocketUrl("https://rooms.example", "BCDFG", "a.b.c")).toBe(
      "wss://rooms.example/v1/rooms/BCDFG/ws?t=a.b.c",
    );
    expect(roomSocketUrl("http://localhost:8787", "BCDFG", "t")).toBe(
      "ws://localhost:8787/v1/rooms/BCDFG/ws?t=t",
    );
  });

  it("signs a guest ticket the rooms Worker accepts", async () => {
    const pair = await generateKeyPair("Ed25519", { extractable: true });
    const url = await guestTicketUrl({ gid: "guest-123456789012", name: "Ada" }, "BCDFG", {
      TICKET_PRIVATE_JWK: JSON.stringify(await exportJWK(pair.privateKey)),
      ROOMS_PUBLIC_URL: "http://localhost:8787",
    });
    const token = new URL(url).searchParams.get("t") ?? "";
    const publicKey = await importTicketPublicKey(await exportJWK(pair.publicKey));
    const verified = await verifyTicket(token, publicKey, { room: "BCDFG" });
    expect(verified.ok && verified.ticket).toMatchObject({
      kind: "guest",
      sub: "guest-123456789012",
      name: "Ada",
    });
  });
});

describe("environment contract", () => {
  const valid = {
    ROOMS_URL: "http://localhost:8787",
    TICKET_PRIVATE_JWK: '{"kty":"OKP","crv":"Ed25519","d":"x","x":"y"}',
    WEB_TO_ROOMS_SECRET: "ci-dummy-web-to-rooms-0123456789abcdef",
    ROOMS_TO_WEB_SECRET: "ci-dummy-rooms-to-web-0123456789abcdef",
    GUEST_SECRET: SECRET,
    AUTH_SECRET: "ci-dummy-auth-secret-0123456789abcdefgh",
  };

  it("parses a complete environment and defaults the public rooms URL", () => {
    expect(parseEnv(valid)).toMatchObject({
      ROOMS_PUBLIC_URL: "http://localhost:8787",
      ENABLE_TEST_PAGES: false,
    });
    expect(parseEnv({ ...valid, ROOMS_PUBLIC_URL: "https://rooms.example" }).ROOMS_PUBLIC_URL).toBe(
      "https://rooms.example",
    );
  });

  it("names what is wrong without echoing values", () => {
    const attempt = () =>
      parseEnv({ ...valid, GUEST_SECRET: "short-secret-value", ROOMS_URL: "localhost:8787" });
    expect(attempt).toThrow(EnvValidationError);
    expect(attempt).toThrow(/GUEST_SECRET/);
    expect(attempt).toThrow(/ROOMS_URL/);
    expect(attempt).not.toThrow(/short-secret-value/);
  });

  it("defaults mail to the log sink and requires both Google values or neither", () => {
    expect(parseEnv(valid)).toMatchObject({
      MAIL_TRANSPORT: "log",
      REQUIRE_EMAIL_VERIFICATION: false,
    });
    expect(() => parseEnv({ ...valid, AUTH_GOOGLE_ID: "id-only" })).toThrow(/AUTH_GOOGLE_SECRET/);
    expect(() => parseEnv({ ...valid, MAIL_TRANSPORT: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(
      parseEnv({ ...valid, MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x", MAIL_FROM: "a@b.c" })
        .MAIL_TRANSPORT,
    ).toBe("resend");
  });

  it("reads the test-pages flag on its own", () => {
    expect(testPagesEnabled({ ENABLE_TEST_PAGES: "1" })).toBe(true);
    expect(testPagesEnabled({ ENABLE_TEST_PAGES: "0" })).toBe(false);
    expect(testPagesEnabled({})).toBe(false);
  });
});
