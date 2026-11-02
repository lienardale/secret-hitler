/**
 * Signed server-to-server requests (website ↔ rooms Worker), with one shared
 * secret per direction. The signature covers a timestamp, the method, the path
 * with its query string, and the body; requests older than 5 minutes are
 * refused.
 *
 *   x-sh-signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 *
 * Uses Web Crypto only, so the same code runs in Node and in workerd.
 */
export const SIGNATURE_HEADER = "x-sh-signature";
export const SIGNATURE_WINDOW_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

export interface SignedRequestParts {
  method: string;
  /** Path and query string, e.g. `/internal/rooms?x=1`. */
  path: string;
  body: string;
}

const encoder = new TextEncoder();

async function hmacKey(secret: string, usage: "sign" | "verify") {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`HMAC secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function canonical(parts: SignedRequestParts, timestamp: number): Uint8Array {
  return encoder.encode(
    `${timestamp}\n${parts.method.toUpperCase()}\n${parts.path}\n${parts.body}`,
  );
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return bytes;
}

/** The `x-sh-signature` header value for a request. */
export async function signRequest(
  secret: string,
  parts: SignedRequestParts,
  now: number = Date.now(),
): Promise<string> {
  const timestamp = Math.floor(now / 1000);
  const key = await hmacKey(secret, "sign");
  const mac = await crypto.subtle.sign("HMAC", key, canonical(parts, timestamp));
  return `t=${timestamp},v1=${toHex(mac)}`;
}

/** Checks a signature header in constant time (Web Crypto `verify`). */
export async function verifyRequest(
  secret: string,
  parts: SignedRequestParts,
  header: string | null,
  now: number = Date.now(),
): Promise<boolean> {
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_WINDOW_SECONDS) return false;
  const key = await hmacKey(secret, "verify");
  return crypto.subtle.verify(
    "HMAC",
    key,
    fromHex(match[2] as string),
    canonical(parts, timestamp),
  );
}
