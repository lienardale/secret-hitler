/**
 * POST /api/internal/reports: a player's report, built by the room and sent
 * by its outbox (rooms Worker → website, HMAC with ROOMS_TO_WEB_SECRET;
 * docs/protocol.md § Server to server). Stored by lib/moderation/ingest.ts.
 *
 * The outbox acts on the status: 2xx (and 409) done, 400/422 dropped for
 * good, anything else retried with backoff for 3 days. So:
 *   200 { ok: true, duplicate }   stored now, or already stored
 *   400                           not JSON, or not a valid report
 *   401                           missing, forged or stale signature
 *   413                           body over 256 KB
 *   500                           database failure (retried)
 *
 * Never log the body: it holds chat.
 */
import { SIGNATURE_HEADER, reportPayloadSchema, verifyRequest } from "@sh/protocol";

import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { InvalidReportError, ingestReport } from "@/lib/moderation/ingest";

export const dynamic = "force-dynamic";

/** The path the outbox signs. */
const SIGNED_PATH = "/api/internal/reports";
/** 100 chat messages of 300 characters and a game's events: well under this. */
const MAX_BODY_BYTES = 256 * 1024;

const noStore = { "cache-control": "no-store" };

function answer(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: noStore });
}

/** The body as text, or null once it grows past `max` bytes (stops reading there). */
async function readBody(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** What may be logged about a failure: its class and Prisma code, never its message. */
function failureSummary(error: unknown): string {
  if (typeof error !== "object" || error === null) return typeof error;
  const name = error instanceof Error ? error.name : "object";
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${name}${code}`;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readBody(request, MAX_BODY_BYTES);
  if (body === null) return answer(413, { error: "too_large" });

  const signed = await verifyRequest(
    getEnv().ROOMS_TO_WEB_SECRET,
    { method: "POST", path: SIGNED_PATH, body },
    request.headers.get(SIGNATURE_HEADER),
  );
  if (!signed) return answer(401, { error: "bad_signature" });

  const json = parseJson(body);
  if (!json.ok) return answer(400, { error: "invalid_json" });
  const payload = reportPayloadSchema.safeParse(json.value);
  if (!payload.success) return answer(400, { error: "invalid_payload" });

  try {
    const { duplicate } = await ingestReport(prisma, payload.data);
    return answer(200, { ok: true, duplicate });
  } catch (error) {
    if (error instanceof InvalidReportError) return answer(400, { error: "invalid_payload" });
    console.error(`report not stored: ${failureSummary(error)}`);
    return answer(500, { error: "unavailable" });
  }
}
