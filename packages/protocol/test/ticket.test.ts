import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  TICKET_ALG,
  TICKET_AUDIENCE,
  TICKET_ISSUER,
  importTicketPrivateKey,
  importTicketPublicKey,
  signTicket,
  verifyTicket,
  type TicketClaims,
} from "../src";

type Key = Awaited<ReturnType<typeof importTicketPublicKey>>;

const claims: TicketClaims = {
  kind: "guest",
  sub: "guest-1",
  name: "Ada",
  room: "BCDFG",
  blocks: ["u:someone"],
  mod: false,
  pv: 1,
};
const now = 1_800_000_000_000;

let privateKey: Key;
let publicKey: Key;
let otherPrivateKey: Key;

beforeAll(async () => {
  const pair = await generateKeyPair(TICKET_ALG, { extractable: true });
  privateKey = await importTicketPrivateKey(await exportJWK(pair.privateKey));
  publicKey = await importTicketPublicKey(JSON.stringify(await exportJWK(pair.publicKey)));
  const other = await generateKeyPair(TICKET_ALG, { extractable: true });
  otherPrivateKey = await importTicketPrivateKey(await exportJWK(other.privateKey));
});

describe("room tickets", () => {
  it("round-trips claims with a fresh jti", async () => {
    const a = await signTicket(claims, privateKey, { now });
    const b = await signTicket(claims, privateKey, { now });
    const result = await verifyTicket(a, publicKey, { room: "BCDFG", now: now + 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticket).toMatchObject(claims);
    expect(result.ticket.exp).toBe(now / 1000 + 60);
    const other = await verifyTicket(b, publicKey, { room: "BCDFG", now });
    expect(other.ok && other.ticket.jti).not.toBe(result.ticket.jti);
  });

  it("expires after 60 seconds (5 s clock tolerance)", async () => {
    const token = await signTicket(claims, privateKey, { now });
    expect((await verifyTicket(token, publicKey, { room: "BCDFG", now: now + 64_000 })).ok).toBe(
      true,
    );
    expect(await verifyTicket(token, publicKey, { room: "BCDFG", now: now + 66_000 })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("is valid for one room only", async () => {
    const token = await signTicket(claims, privateKey, { now });
    expect(await verifyTicket(token, publicKey, { room: "ZZZZZ", now })).toEqual({
      ok: false,
      reason: "room",
    });
  });

  it("refuses a ticket signed with another key", async () => {
    const token = await signTicket(claims, otherPrivateKey, { now });
    expect(await verifyTicket(token, publicKey, { room: "BCDFG", now })).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("refuses a tampered payload", async () => {
    const token = await signTicket(claims, privateKey, { now });
    const [header, , signature] = token.split(".");
    const forged = btoa(JSON.stringify({ ...claims, mod: true })).replace(/=+$/, "");
    expect(
      (await verifyTicket(`${header}.${forged}.${signature}`, publicKey, { room: "BCDFG", now }))
        .ok,
    ).toBe(false);
  });

  it("refuses garbage and unsigned tokens", async () => {
    expect(await verifyTicket("not.a.jwt", publicKey, { room: "BCDFG", now })).toEqual({
      ok: false,
      reason: "malformed",
    });
    const unsigned = `${btoa('{"alg":"none"}')}.${btoa(JSON.stringify(claims))}.`;
    expect((await verifyTicket(unsigned, publicKey, { room: "BCDFG", now })).ok).toBe(false);
  });

  it("refuses long-lived tickets", async () => {
    const token = await signTicket(claims, privateKey, { now, ttlSeconds: 3600 });
    expect(await verifyTicket(token, publicKey, { room: "BCDFG", now })).toEqual({
      ok: false,
      reason: "claims",
    });
  });

  it("refuses the wrong issuer or audience", async () => {
    const iat = now / 1000;
    const build = (iss: string, aud: string) =>
      new SignJWT({ ...claims })
        .setProtectedHeader({ alg: TICKET_ALG })
        .setIssuer(iss)
        .setAudience(aud)
        .setIssuedAt(iat)
        .setExpirationTime(iat + 60)
        .setJti("x")
        .sign(privateKey);
    const opts = { room: "BCDFG", now };
    expect(
      (await verifyTicket(await build(TICKET_ISSUER, TICKET_AUDIENCE), publicKey, opts)).ok,
    ).toBe(true);
    expect(await verifyTicket(await build("evil", TICKET_AUDIENCE), publicKey, opts)).toEqual({
      ok: false,
      reason: "claims",
    });
    expect(await verifyTicket(await build(TICKET_ISSUER, "evil"), publicKey, opts)).toEqual({
      ok: false,
      reason: "claims",
    });
  });

  it("refuses unknown or missing claims", async () => {
    const iat = now / 1000;
    const token = await new SignJWT({ ...claims, admin: true })
      .setProtectedHeader({ alg: TICKET_ALG })
      .setIssuer(TICKET_ISSUER)
      .setAudience(TICKET_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 60)
      .setJti("x")
      .sign(privateKey);
    expect(await verifyTicket(token, publicKey, { room: "BCDFG", now })).toEqual({
      ok: false,
      reason: "claims",
    });
  });

  it("will not sign invalid claims", async () => {
    await expect(signTicket({ ...claims, name: "x" }, privateKey, { now })).rejects.toThrow();
  });

  it("keeps private keys out of the verifier", async () => {
    const pair = await generateKeyPair(TICKET_ALG, { extractable: true });
    const jwk = await exportJWK(pair.privateKey);
    await expect(importTicketPublicKey(jwk)).rejects.toThrow(/public JWK/);
    await expect(importTicketPrivateKey(await exportJWK(pair.publicKey))).rejects.toThrow(/no `d`/);
    await expect(importTicketPublicKey('{"kty":"RSA"}')).rejects.toThrow(/Ed25519/);
  });
});
