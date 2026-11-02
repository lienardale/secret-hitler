/**
 * Reports from the rooms Worker (real Postgres): idempotent storage on
 * `reportId`, accounts vs guests vs deleted accounts, and the signed route
 * (statuses the outbox acts on). Never logs the chat.
 */
import {
  SIGNATURE_HEADER,
  reportPayloadSchema,
  signRequest,
  type ReportPayload,
} from "@sh/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/internal/reports/route";
import { prisma } from "@/lib/db/prisma";
import { InvalidReportError, ingestReport } from "@/lib/moderation/ingest";

import { createAccount } from "../_fixtures/game-result";

// Before anything calls getEnv() (it caches): the route checks the whole contract.
const SECRET = vi.hoisted(() => {
  const secret = "test-rooms-to-web-secret-0123456789abcdef";
  process.env.ROOMS_TO_WEB_SECRET = secret;
  process.env.ROOMS_URL ??= "http://localhost:8787";
  process.env.TICKET_PRIVATE_JWK ??= '{"kty":"OKP","crv":"Ed25519","x":"test","d":"test"}';
  process.env.WEB_TO_ROOMS_SECRET ??= "test-web-to-rooms-secret-0123456789abcdef";
  process.env.GUEST_SECRET ??= "test-guest-secret-0123456789abcdefghijkl";
  return secret;
});

const PATH = "/api/internal/reports";
const CREATED_AT = Date.parse("2026-11-02T10:00:00Z");
/** A chat line that must never reach a log. */
const SECRET_CHAT = "chat line nobody may log 7f3a";

interface PartyOptions {
  kind?: "user" | "guest";
  sub?: string;
  name?: string;
}

function reportPayload(
  options: { reportId?: string; reporter?: PartyOptions; target?: PartyOptions } = {},
): ReportPayload {
  const reporter = {
    pid: "p1",
    kind: options.reporter?.kind ?? "guest",
    sub: options.reporter?.sub ?? "guest-reporter",
    name: options.reporter?.name ?? "Alice",
  };
  const target = {
    pid: "p2",
    kind: options.target?.kind ?? "guest",
    sub: options.target?.sub ?? "guest-target",
    name: options.target?.name ?? "Bob",
  };
  return reportPayloadSchema.parse({
    reportId: options.reportId ?? crypto.randomUUID(),
    room: "BCDFG",
    visibility: "public",
    lang: "fr",
    createdAt: CREATED_AT,
    reason: "harassment",
    details: "Insults all game long.",
    reporter,
    target,
    evidence: {
      status: "playing",
      game: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", number: 2 },
      members: [
        { ...reporter, seat: 0, host: true, connected: true },
        { ...target, seat: 1, host: false, connected: true },
        {
          pid: "p3",
          kind: "guest",
          sub: "guest-3",
          name: "Carol",
          seat: null,
          host: false,
          connected: false,
        },
      ],
      chat: [
        { kind: "system", id: 1, at: CREATED_AT - 60_000, key: "gameStarted", params: {} },
        {
          kind: "player",
          id: 2,
          at: CREATED_AT - 30_000,
          pid: "p2",
          name: target.name,
          text: SECRET_CHAT,
        },
      ],
      events: [],
    },
  } satisfies ReportPayload);
}

async function rows(id: string) {
  return prisma.report.findMany({ where: { id } });
}

/** Calls the route handler like the outbox does; `signature: null` sends none. */
async function post(
  body: string,
  options: { signature?: string | null; secret?: string; signedAt?: number } = {},
): Promise<Response> {
  const signature =
    options.signature !== undefined
      ? options.signature
      : await signRequest(
          options.secret ?? SECRET,
          { method: "POST", path: PATH, body },
          options.signedAt,
        );
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set(SIGNATURE_HEADER, signature);
  return POST(new Request(`http://localhost:3000${PATH}`, { method: "POST", body, headers }));
}

/** Every console line written while `run` runs. */
async function consoleLines(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  for (const channel of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
      lines.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    });
  }
  await run();
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("ingestReport", () => {
  it("stores the report with its evidence, linking live accounts", async () => {
    const alice = await createAccount("Alice");
    const bob = await createAccount("Bob");
    const payload = reportPayload({
      reporter: { kind: "user", sub: alice, name: "Alice" },
      target: { kind: "user", sub: bob, name: "Bob 2" },
    });
    expect(await ingestReport(prisma, payload)).toEqual({ duplicate: false });

    const [report] = await rows(payload.reportId);
    expect(report).toMatchObject({
      id: payload.reportId,
      room: "BCDFG",
      reporterId: alice,
      reporterName: "Alice",
      targetId: bob,
      // The name the room showed (with its " 2" suffix), kept for the record.
      targetName: "Bob 2",
      reason: "harassment",
      details: "Insults all game long.",
      status: "open",
      createdAt: new Date(CREATED_AT),
      resolvedAt: null,
      resolvedById: null,
    });
    expect(report?.evidence).toEqual(payload.evidence);
    expect(report?.receivedAt.getTime()).toBeGreaterThan(CREATED_AT);
  });

  it("answers duplicate to a repeated delivery and changes nothing", async () => {
    const payload = reportPayload();
    await ingestReport(prisma, payload);
    await prisma.report.update({ where: { id: payload.reportId }, data: { status: "dismissed" } });

    const again = { ...payload, details: "Changed", reason: "spam" as const };
    expect(await ingestReport(prisma, again)).toEqual({ duplicate: true });
    expect(await ingestReport(prisma, payload)).toEqual({ duplicate: true });
    const stored = await rows(payload.reportId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      details: "Insults all game long.",
      reason: "harassment",
      status: "dismissed",
    });
  });

  it("stores concurrent deliveries once, every one succeeds, and nothing is logged", async () => {
    const payload = reportPayload();
    let results: { duplicate: boolean }[] = [];
    const lines = await consoleLines(async () => {
      results = await Promise.all(Array.from({ length: 6 }, () => ingestReport(prisma, payload)));
    });
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await rows(payload.reportId)).toHaveLength(1);
    expect(lines).toEqual([]);
  });

  it("stores unknown, deleted and malformed accounts with null ids, and keeps every name", async () => {
    const gone = await createAccount("Gone");
    await prisma.user.delete({ where: { id: gone } });
    const deleted = reportPayload({
      reporter: { kind: "user", sub: gone, name: "Gone" },
      target: { kind: "user", sub: "00000000-0000-4000-8000-00000000abcd", name: "Nobody" },
    });
    const malformed = reportPayload({
      reporter: { kind: "user", sub: "not-a-uuid", name: "Odd" },
      target: { kind: "guest", sub: "guest-xyz", name: "Guest" },
    });
    await ingestReport(prisma, deleted);
    await ingestReport(prisma, malformed);

    const select = { reporterId: true, reporterName: true, targetId: true, targetName: true };
    expect(await prisma.report.findUnique({ where: { id: deleted.reportId }, select })).toEqual({
      reporterId: null,
      reporterName: "Gone",
      targetId: null,
      targetName: "Nobody",
    });
    expect(await prisma.report.findUnique({ where: { id: malformed.reportId }, select })).toEqual({
      reporterId: null,
      reporterName: "Odd",
      targetId: null,
      targetName: "Guest",
    });
  });

  it("never links a guest whose id happens to be an account's id", async () => {
    const ada = await createAccount("Ada");
    const payload = reportPayload({ target: { kind: "guest", sub: ada, name: "Ada" } });
    await ingestReport(prisma, payload);
    expect((await rows(payload.reportId))[0]?.targetId).toBeNull();
  });

  it("keeps the report when an account is deleted later (ids set to null)", async () => {
    const grace = await createAccount("Grace");
    const payload = reportPayload({ reporter: { kind: "user", sub: grace, name: "Grace" } });
    await ingestReport(prisma, payload);
    expect((await rows(payload.reportId))[0]?.reporterId).toBe(grace);
    await prisma.user.delete({ where: { id: grace } });
    expect((await rows(payload.reportId))[0]).toMatchObject({
      reporterId: null,
      reporterName: "Grace",
    });
  });

  it("refuses a snapshot time out of range", async () => {
    const payload = { ...reportPayload(), createdAt: 9e15 };
    await expect(ingestReport(prisma, payload)).rejects.toBeInstanceOf(InvalidReportError);
    expect(await rows(payload.reportId)).toHaveLength(0);
  });
});

describe("POST /api/internal/reports", () => {
  it("stores a signed report, then answers duplicate", async () => {
    const payload = reportPayload();
    const body = JSON.stringify(payload);

    const first = await post(body);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ ok: true, duplicate: false });

    const second = await post(body);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(await rows(payload.reportId)).toHaveLength(1);
  });

  it("stores concurrent signed deliveries once", async () => {
    const payload = reportPayload();
    const body = JSON.stringify(payload);
    const answers = await Promise.all(Array.from({ length: 4 }, () => post(body)));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200]);
    const bodies = (await Promise.all(answers.map((a) => a.json()))) as { duplicate: boolean }[];
    expect(bodies.filter((b) => !b.duplicate)).toHaveLength(1);
    expect(await rows(payload.reportId)).toHaveLength(1);
  });

  it("refuses a missing, forged or stale signature with 401 and stores nothing", async () => {
    const payload = reportPayload();
    const body = JSON.stringify(payload);
    const forged = await post(body, { secret: "another-secret-0123456789abcdefghijklmn" });
    expect(forged.status).toBe(401);
    expect(forged.headers.get("cache-control")).toBe("no-store");
    expect(await forged.json()).toEqual({ error: "bad_signature" });
    expect((await post(body, { signature: null })).status).toBe(401);
    expect((await post(body, { signature: "t=1,v1=nothex" })).status).toBe(401);
    expect((await post(body, { signedAt: Date.now() - 6 * 60_000 })).status).toBe(401);

    // A signature covers the body: another body under a valid signature is forged too.
    const signature = await signRequest(SECRET, { method: "POST", path: PATH, body });
    const tampered = JSON.stringify({ ...payload, reason: "spam" });
    expect((await post(tampered, { signature })).status).toBe(401);
    // …and the path: a games signature does not open the reports route.
    const gamesSignature = await signRequest(SECRET, {
      method: "POST",
      path: "/api/internal/games",
      body,
    });
    expect((await post(body, { signature: gamesSignature })).status).toBe(401);
    expect(await rows(payload.reportId)).toHaveLength(0);
  });

  it("answers 400 to invalid JSON and to invalid payloads (the outbox then drops them)", async () => {
    const bad = await post("{not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_json" });

    const payload = reportPayload();
    const invalid = await post(JSON.stringify({ ...payload, reportId: "nope" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_payload" });

    expect((await post(JSON.stringify({ ...payload, extra: true }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...payload, reason: "rude" }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...payload, details: "x".repeat(501) }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...payload, createdAt: 9e15 }))).status).toBe(400);
    expect(await rows(payload.reportId)).toHaveLength(0);
  });

  it("answers 413 to a body over 256 KB", async () => {
    const huge = JSON.stringify({ padding: "x".repeat(256 * 1024) });
    const answer = await post(huge);
    expect(answer.status).toBe(413);
    expect(await answer.json()).toEqual({ error: "too_large" });
  });

  it("answers 500 on a database failure without logging the chat", async () => {
    const payload = reportPayload();
    vi.spyOn(prisma.report, "createMany").mockRejectedValue(
      Object.assign(new Error(`connection lost while writing ${SECRET_CHAT}`), { code: "P1001" }),
    );
    let answer: Response | undefined;
    const lines = await consoleLines(async () => {
      answer = await post(JSON.stringify(payload));
    });
    expect(answer?.status).toBe(500);
    expect(await answer?.json()).toEqual({ error: "unavailable" });
    expect(lines).toEqual(["report not stored: Error P1001"]);
  });
});
