/**
 * Room tickets: short-lived JWTs that let a browser open a room's WebSocket.
 *
 * The website signs them with an Ed25519 private key after checking the
 * session or guest cookie; the rooms Worker only holds the public key, so it
 * can check tickets but never mint them. A ticket names one room, lives 60 s,
 * and its `jti` is accepted once by that room.
 */
import { SignJWT, errors, importJWK, jwtVerify, type CryptoKey, type JWK } from "jose";
import { z } from "zod";

import { IDENTITY_KINDS } from "./constants";
import { displayNameSchema, identityKeySchema, roomCodeSchema, subjectSchema } from "./primitives";

export const TICKET_ALG = "Ed25519";
export const TICKET_ISSUER = "sh-web";
export const TICKET_AUDIENCE = "sh-rooms";
export const TICKET_TTL_SECONDS = 60;
const CLOCK_TOLERANCE_SECONDS = 5;

export const ticketClaimsSchema = z.strictObject({
  kind: z.enum(IDENTITY_KINDS),
  sub: subjectSchema,
  name: displayNameSchema,
  room: roomCodeSchema,
  /** Identity keys this player blocked: their chat is hidden from them. */
  blocks: z.array(identityKeySchema).max(500),
  /** Moderator: may join any room as a spectator (M5). */
  mod: z.boolean(),
  /** Protocol version of the page that asked for the ticket. */
  pv: z.int().positive(),
});

export type TicketClaims = z.infer<typeof ticketClaimsSchema>;

export interface VerifiedTicket extends TicketClaims {
  jti: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

export type TicketFailure = "malformed" | "signature" | "expired" | "claims" | "room";

function parseJwk(jwk: JWK | string): JWK {
  const parsed: unknown = typeof jwk === "string" ? JSON.parse(jwk) : jwk;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as JWK).kty !== "OKP" ||
    (parsed as JWK).crv !== "Ed25519"
  ) {
    throw new Error("ticket key: expected an Ed25519 JWK");
  }
  return parsed;
}

export async function importTicketPrivateKey(jwk: JWK | string): Promise<CryptoKey> {
  const parsed = parseJwk(jwk);
  if (typeof parsed.d !== "string") throw new Error("ticket key: private JWK has no `d`");
  return (await importJWK(parsed, TICKET_ALG)) as CryptoKey;
}

export async function importTicketPublicKey(jwk: JWK | string): Promise<CryptoKey> {
  const parsed = parseJwk(jwk);
  // Refuse a private key here: the Worker must never be able to mint tickets.
  if ("d" in parsed) throw new Error("ticket key: expected a public JWK, got a private one");
  return (await importJWK(parsed, TICKET_ALG)) as CryptoKey;
}

export async function signTicket(
  claims: TicketClaims,
  privateKey: CryptoKey,
  options: { now?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const valid = ticketClaimsSchema.parse(claims);
  const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
  return new SignJWT({ ...valid })
    .setProtectedHeader({ alg: TICKET_ALG, typ: "JWT" })
    .setIssuer(TICKET_ISSUER)
    .setAudience(TICKET_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + (options.ttlSeconds ?? TICKET_TTL_SECONDS))
    .setJti(crypto.randomUUID())
    .sign(privateKey);
}

export async function verifyTicket(
  token: string,
  publicKey: CryptoKey,
  options: { room: string; now?: number },
): Promise<{ ok: true; ticket: VerifiedTicket } | { ok: false; reason: TicketFailure }> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, publicKey, {
      algorithms: [TICKET_ALG],
      issuer: TICKET_ISSUER,
      audience: TICKET_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: new Date(options.now ?? Date.now()),
      maxTokenAge: TICKET_TTL_SECONDS + CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["jti", "iat", "exp"],
    }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    if (error instanceof errors.JWSSignatureVerificationFailed) {
      return { ok: false, reason: "signature" };
    }
    if (error instanceof errors.JWTClaimValidationFailed) return { ok: false, reason: "claims" };
    return { ok: false, reason: "malformed" };
  }

  // Registered claims are checked above; the rest must be exactly our claims.
  const { iss, aud, iat, exp, jti, nbf, ...rest } = payload;
  void [iss, aud, nbf];
  const claims = ticketClaimsSchema.safeParse(rest);
  if (
    !claims.success ||
    typeof jti !== "string" ||
    jti.length > 64 ||
    typeof exp !== "number" ||
    typeof iat !== "number" ||
    exp - iat > TICKET_TTL_SECONDS
  ) {
    return { ok: false, reason: "claims" };
  }
  if (claims.data.room !== options.room) return { ok: false, reason: "room" };
  return { ok: true, ticket: { ...claims.data, jti, exp } };
}
