/**
 * Moderation through the real Worker and Durable Objects (M5): reports queued
 * by a room and delivered by its alarm, member lookup, and bans / renames
 * applied to live rooms (listed by the website, or found through the lobby).
 */
import {
  CLOSE,
  SIGNATURE_HEADER,
  reportPayloadSchema,
  verifyRequest,
  type ModerationRequest,
  type RoomMemberRequest,
  type RoomReportRequest,
} from "@sh/protocol";
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GameRoom } from "../src/room/GameRoom";
import { Client, createRoom, roomStub, signedFetch, type TestIdentity } from "./helpers/worker";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A user identity no other test uses (the lobby is shared by the whole file). */
function freshUser(name: string): TestIdentity {
  return { kind: "user", sub: `m${crypto.randomUUID().slice(0, 13)}`, name };
}

const keyOf = (identity: TestIdentity) => `u:${identity.sub}`;

function outboxSize(stub: DurableObjectStub<GameRoom>): Promise<number> {
  return runInDurableObject(stub, (_instance, state) => {
    return state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n;
  });
}

async function connect(code: string, identity: TestIdentity): Promise<Client> {
  const client = await Client.connect(code, identity);
  await client.welcomed();
  if (client.closed) throw new Error(`refused: ${client.closed.code}`);
  return client;
}

function post(path: string, body: unknown): Promise<Response> {
  return signedFetch("POST", path, JSON.stringify(body));
}

function moderation(request: ModerationRequest): Promise<Response> {
  return post("/internal/moderation", request);
}

describe("reports", () => {
  it("queues a report and delivers it from the alarm, signed, to the website", async () => {
    const players = [1, 2, 3, 4, 5].map((n) => freshUser(`User ${n}`));
    const [host, target] = players as [TestIdentity, TestIdentity];
    const code = await createRoom({ host });
    const clients: Client[] = [];
    for (const player of players) clients.push(await connect(code, player));
    const [hostClient, targetClient] = clients as [Client, Client];
    targetClient.send({ t: "chat", text: "hello table" });
    await hostClient.until(
      (c) => c.messages.some((m) => m.t === "chat" && m.message.kind === "player"),
      "chat",
    );
    hostClient.send({ t: "start" });
    for (const client of clients) await client.until((c) => c.view !== null, "game start");

    const stub = roomStub(code);
    const request: RoomReportRequest = {
      reportId: crypto.randomUUID(),
      reporter: keyOf(host),
      target: targetClient.pid,
      reason: "harassment",
      details: "insults in the chat",
    };
    const path = `/internal/rooms/${code}/report`;
    const first = await post(path, request);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ ok: true });
    // The website retries: the same report id is queued once.
    expect((await post(path, request)).status).toBe(202);
    expect(await outboxSize(stub)).toBe(1);
    // Delivery is the alarm's job, scheduled right away (never a fetch in the call).
    const alarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect((alarm ?? Infinity) - Date.now()).toBeLessThanOrEqual(1_000);

    // Captured inside the mock: a request body made by the room cannot be read from the test.
    const requests: { url: string; signature: string | null; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        signature: new Headers(init?.headers).get(SIGNATURE_HEADER),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return Promise.resolve(Response.json({ ok: true, duplicate: false }));
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await outboxSize(stub)).toBe(0);
    expect(requests).toHaveLength(1);

    const delivered = requests[0];
    expect(delivered?.url).toBe("https://web.test/api/internal/reports");
    const body = delivered?.body ?? "";
    const signed = await verifyRequest(
      env.ROOMS_TO_WEB_SECRET,
      { method: "POST", path: "/api/internal/reports", body },
      delivered?.signature ?? null,
    );
    expect(signed).toBe(true);
    const payload = reportPayloadSchema.parse(JSON.parse(body));
    expect(payload).toMatchObject({
      reportId: request.reportId,
      room: code,
      reason: "harassment",
      reporter: { kind: "user", sub: host.sub, pid: hostClient.pid },
      target: { kind: "user", sub: target.sub, pid: targetClient.pid },
    });
    expect(payload.evidence.status).toBe("playing");
    expect(payload.evidence.members).toHaveLength(5);
    expect(payload.evidence.chat.some((m) => m.kind === "player" && m.text === "hello table")).toBe(
      true,
    );
    expect(payload.evidence.events.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/"policies"|"roles"|"seed"|"deck"/);
  });

  it("answers 404 for a missing room and 422 with the reason it refuses", async () => {
    const [a, b] = [freshUser("Ada"), freshUser("Bob")];
    const code = await createRoom({ host: a });
    const ada = await connect(code, a);
    await connect(code, b);
    const request: RoomReportRequest = {
      reportId: crypto.randomUUID(),
      reporter: keyOf(a),
      target: ada.pid,
      reason: "spam",
      details: "",
    };
    const self = await post(`/internal/rooms/${code}/report`, request);
    expect(self.status).toBe(422);
    expect(await self.json()).toEqual({ error: "self" });
    const stranger = await post(`/internal/rooms/${code}/report`, {
      ...request,
      reporter: "u:stranger",
    });
    expect(await stranger.json()).toEqual({ error: "not_member" });
    for (const room of ["ZZZZZ", "abcde"]) {
      const missing = await post(`/internal/rooms/${room}/report`, request);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "no_room" });
    }
    expect(await outboxSize(roomStub(code))).toBe(0);
  });
});

describe("member lookup", () => {
  it("tells a member who is behind a pid, and nobody else", async () => {
    const [a, b] = [freshUser("Ada"), freshUser("Bob")];
    const code = await createRoom({ host: a });
    await connect(code, a);
    const bob = await connect(code, b);
    const ask = (request: RoomMemberRequest, room = code) =>
      post(`/internal/rooms/${room}/member`, request);

    const found = await ask({ requester: keyOf(a), pid: bob.pid });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ kind: "user", sub: b.sub, name: "Bob" });

    const outsider = await ask({ requester: "u:outsider", pid: bob.pid });
    expect(outsider.status).toBe(422);
    expect(await outsider.json()).toEqual({ error: "not_member" });
    const unknown = await ask({ requester: keyOf(a), pid: "nobody" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "unknown_target" });
    const missing = await ask({ requester: keyOf(a), pid: bob.pid }, "ZZZZZ");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "no_room" });
  });
});

describe("moderation", () => {
  it("bans an account from a listed room: closes it with 4451 and refuses it after", async () => {
    const [a, b] = [freshUser("Ada"), freshUser("Bob")];
    const code = await createRoom({ host: a });
    const ada = await connect(code, a);
    const bob = await connect(code, b);

    const response = await moderation({
      identity: keyOf(b),
      rooms: [code, "ZZZZZ"],
      action: { kind: "ban" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: [code] });
    expect(await bob.closeCode()).toBe(CLOSE.banned);
    await ada.until(
      (c) =>
        c.messages.some(
          (m) => m.t === "chat" && m.message.kind === "system" && m.message.key === "playerRemoved",
        ),
      "playerRemoved",
    );
    await ada.until((c) => c.room?.players.length === 1, "seat freed");

    const again = await Client.connect(code, b);
    expect(await again.closeCode()).toBe(CLOSE.banned);
  });

  it("renames an account in its live rooms", async () => {
    const [a, b] = [freshUser("Ada"), freshUser("Bob")];
    const code = await createRoom({ host: a });
    const ada = await connect(code, a);
    const bob = await connect(code, b);
    const response = await moderation({
      identity: keyOf(b),
      rooms: [code],
      action: { kind: "rename", name: "Player 12345" },
    });
    expect(await response.json()).toEqual({ applied: [code] });
    await ada.until(
      (c) => c.room?.players.find((p) => p.pid === bob.pid)?.name === "Player 12345",
      "new name",
    );
    const renamed = ada.messages.find(
      (m) => m.t === "chat" && m.message.kind === "system" && m.message.key === "playerRenamed",
    );
    expect(renamed?.t === "chat" && renamed.message).toMatchObject({
      params: { old: "Bob", name: "Player 12345" },
    });
    expect(bob.closed).toBeNull();
  });

  it("finds the public rooms an account is in through the lobby", async () => {
    const [a, b] = [freshUser("Ada"), freshUser("Bob")];
    const code = await createRoom({ visibility: "public", lang: "en", host: a });
    await connect(code, a);
    const bob = await connect(code, b);
    // The room tells the lobby who is in it from its alarm.
    await runDurableObjectAlarm(roomStub(code));
    expect(await env.LOBBY.getByName("global").roomsWith(keyOf(b))).toEqual([code]);

    const response = await moderation({ identity: keyOf(b), rooms: [], action: { kind: "ban" } });
    expect(await response.json()).toEqual({ applied: [code] });
    expect(await bob.closeCode()).toBe(CLOSE.banned);
    const again = await Client.connect(code, b);
    expect(await again.closeCode()).toBe(CLOSE.banned);
  });

  it("applies nothing to an account in no live room", async () => {
    const response = await moderation({
      identity: keyOf(freshUser("Nobody")),
      rooms: ["ZZZZZ"],
      action: { kind: "ban" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: [] });
  });
});
