import { CLOSE, importTicketPrivateKey, signRequest } from "@sh/protocol";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import { HMAC_VECTOR } from "../../../packages/protocol/test/vectors";
import {
  Client,
  ORIGIN,
  createRoom,
  guestId,
  openSocket,
  signedFetch,
  ticket,
  userId,
} from "./helpers/worker";

async function closeCodeFor(code: string, token: string): Promise<number> {
  const client = await Client.connectWith(code, token);
  return client.closeCode();
}

describe("room WebSocket checks", () => {
  it("refuses requests without an allowed Origin, or without upgrade", async () => {
    const code = await createRoom();
    const token = await ticket(code, guestId(1));
    const path = `/v1/rooms/${code}/ws?t=${token}`;
    expect((await openSocket(path, {})).response.status).toBe(403);
    expect((await openSocket(path, { Origin: "https://evil.example" })).response.status).toBe(403);
    const plain = await openSocket(path, { Origin: ORIGIN, Upgrade: "h2c" });
    expect(plain.response.status).toBe(426);
  });

  it("closes with 4404 for an invalid or unknown room code", async () => {
    expect(await closeCodeFor("abcde", await ticket("BCDFG", guestId(1)))).toBe(CLOSE.roomNotFound);
    expect(await closeCodeFor("ZZZZZ", await ticket("ZZZZZ", guestId(1)))).toBe(CLOSE.roomNotFound);
  });

  it("closes with 4401 for a missing, forged, expired or misdirected ticket", async () => {
    const code = await createRoom();
    const other = await createRoom();
    const { ws } = await openSocket(`/v1/rooms/${code}/ws`);
    await new Promise((resolve) => ws?.addEventListener("close", resolve));

    const pair = await generateKeyPair("Ed25519", { extractable: true });
    const forgedKey = await importTicketPrivateKey(await exportJWK(pair.privateKey));
    const forged = await ticket(code, guestId(1), {}, { key: forgedKey });
    expect(await closeCodeFor(code, forged)).toBe(CLOSE.unauthorized);

    const expired = await ticket(code, guestId(1), {}, { now: Date.now() - 120_000 });
    expect(await closeCodeFor(code, expired)).toBe(CLOSE.unauthorized);

    expect(await closeCodeFor(code, await ticket(other, guestId(1)))).toBe(CLOSE.unauthorized);
    expect(await closeCodeFor(code, "not-a-ticket")).toBe(CLOSE.unauthorized);
  });

  it("accepts a ticket once", async () => {
    const code = await createRoom();
    const token = await ticket(code, guestId(1));
    const first = await Client.connectWith(code, token);
    await first.welcomed();
    expect(first.closed).toBeNull();
    expect(await closeCodeFor(code, token)).toBe(CLOSE.unauthorized);
  });

  it("asks old pages to reload (4426)", async () => {
    const code = await createRoom();
    expect(await closeCodeFor(code, await ticket(code, guestId(1), { pv: 99 }))).toBe(
      CLOSE.protocolMismatch,
    );
  });

  it("keeps guests out of public rooms (4403)", async () => {
    const code = await createRoom({ visibility: "public", host: userId(1) });
    expect(await closeCodeFor(code, await ticket(code, guestId(2)))).toBe(CLOSE.accountRequired);
    const member = await Client.connect(code, userId(1));
    await member.welcomed();
    expect(member.closed).toBeNull();
  });
});

describe("signed internal endpoints", () => {
  const body = JSON.stringify({
    visibility: "private",
    lang: "en",
    host: { kind: "guest", sub: "g1", name: "Ada" },
  });

  it("creates a room and reports its info", async () => {
    const created = await signedFetch("POST", "/internal/rooms", body);
    expect(created.status).toBe(201);
    const { code } = await created.json<{ code: string }>();
    const info = await signedFetch("GET", `/internal/rooms/${code}`);
    expect(await info.json()).toEqual({
      code,
      visibility: "private",
      lang: "en",
      status: "lobby",
      players: 0,
      spectators: 0,
    });
    expect((await signedFetch("GET", "/internal/rooms/ZZZZZ")).status).toBe(404);
  });

  it("refuses unsigned, wrongly signed, stale and tampered requests", async () => {
    const unsigned = await exports.default.fetch("https://rooms.test/internal/rooms", {
      method: "POST",
      body,
    });
    expect(unsigned.status).toBe(401);
    const wrongSecret = await signedFetch("POST", "/internal/rooms", body, {
      secret: "ci-dummy-some-other-secret-0123456789abcdef",
    });
    expect(wrongSecret.status).toBe(401);
    const stale = await signedFetch("POST", "/internal/rooms", body, { now: Date.now() - 600_000 });
    expect(stale.status).toBe(401);
    const tampered = await signedFetch("POST", "/internal/rooms", body, {
      sendBody: body.replace("private", "public"),
    });
    expect(tampered.status).toBe(401);
  });

  it("validates what it is asked to create", async () => {
    expect((await signedFetch("POST", "/internal/rooms", "{nope")).status).toBe(400);
    expect((await signedFetch("POST", "/internal/rooms", '{"visibility":"x"}')).status).toBe(400);
    const publicGuest = body.replace("private", "public");
    expect((await signedFetch("POST", "/internal/rooms", publicGuest)).status).toBe(400);
  });

  it("answers quick match", async () => {
    const response = await signedFetch(
      "POST",
      "/internal/lobby/quickmatch",
      JSON.stringify({ identity: "u:nobody", lang: "en", blocks: [] }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("code");
  });

  describe("moderation endpoints (M5)", () => {
    const report = {
      reportId: "10000000-0000-4000-8000-000000000001",
      reporter: "u:u1",
      target: "p1",
      reason: "spam",
      details: "",
    };
    const member = { requester: "u:u1", pid: "p1" };
    const moderation = { identity: "u:u1", rooms: [], action: { kind: "ban" } };
    const endpoints = [
      ["/internal/rooms/BCDFG/report", report],
      ["/internal/rooms/BCDFG/member", member],
      ["/internal/moderation", moderation],
    ] as const;

    it("refuses unsigned and forged calls", async () => {
      for (const [path, payload] of endpoints) {
        const body = JSON.stringify(payload);
        const unsigned = await exports.default.fetch(`https://rooms.test${path}`, {
          method: "POST",
          body,
        });
        expect(unsigned.status, path).toBe(401);
        const forged = await signedFetch("POST", path, body, {
          secret: "ci-dummy-some-other-secret-0123456789abcdef",
        });
        expect(forged.status, path).toBe(401);
        const tampered = await signedFetch("POST", path, body, {
          sendBody: body.replace("u:u1", "u:u2"),
        });
        expect(tampered.status, path).toBe(401);
      }
    });

    it("refuses invalid bodies with 400", async () => {
      const invalid: [string, unknown][] = [
        ["/internal/rooms/BCDFG/report", { ...report, reportId: "not-a-uuid" }],
        ["/internal/rooms/BCDFG/report", { ...report, reason: "boring" }],
        ["/internal/rooms/BCDFG/report", { ...report, details: "x".repeat(501) }],
        ["/internal/rooms/BCDFG/member", { requester: "u:u1" }],
        ["/internal/moderation", { ...moderation, identity: "g:guest" }],
        ["/internal/moderation", { ...moderation, action: { kind: "rename", name: " x" } }],
        ["/internal/moderation", { ...moderation, rooms: ["nope"] }],
      ];
      for (const [path, payload] of invalid) {
        const response = await signedFetch("POST", path, JSON.stringify(payload));
        expect(response.status, `${path} ${JSON.stringify(payload)}`).toBe(400);
      }
      for (const [path] of endpoints) {
        expect((await signedFetch("POST", path, "{nope")).status, path).toBe(400);
      }
    });
  });

  it("signs exactly like Node (shared test vector)", async () => {
    expect(await signRequest(HMAC_VECTOR.secret, HMAC_VECTOR.parts, HMAC_VECTOR.now)).toBe(
      HMAC_VECTOR.header,
    );
    expect(env.WEB_TO_ROOMS_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
