import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { lobbySocketUrl, parseLobbyMessage } from "@/lib/lobby-client/parse";
import { sendMail } from "@/lib/mail/send";

describe("sendMail", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("log transport: sends nothing and appends the mail to the sink file", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const dir = mkdtempSync(join(tmpdir(), "sh-mail-"));
    dirs.push(dir);
    const file = join(dir, "nested", "outbox.jsonl");
    const fetcher = vi.fn();
    const mail = { to: "ada@example.org", subject: "Hello", text: "Link: https://x/y" };
    await sendMail(mail, { MAIL_TRANSPORT: "log", MAIL_SINK_FILE: file }, fetcher);
    await sendMail(
      { ...mail, subject: "Again" },
      { MAIL_TRANSPORT: "log", MAIL_SINK_FILE: file },
      fetcher,
    );
    const lines = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { subject: string });
    expect(lines.map((line) => line.subject)).toEqual(["Hello", "Again"]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resend transport: posts to the Resend API and reports failures without throwing", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const env = {
      MAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_test",
      MAIL_FROM: "SH <no-reply@example.org>",
    } as const;
    expect(
      await sendMail({ to: "ada@example.org", subject: "S", text: "T" }, env, fetcher),
    ).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "SH <no-reply@example.org>",
      to: ["ada@example.org"],
      subject: "S",
      text: "T",
    });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = vi.fn(async () => new Response("no", { status: 403 }));
    expect(await sendMail({ to: "a@b.c", subject: "S", text: "T" }, env, failing)).toEqual({
      ok: false,
    });
    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await sendMail({ to: "a@b.c", subject: "S", text: "T" }, env, throwing)).toEqual({
      ok: false,
    });
  });
});

describe("lobby client parsing", () => {
  const room = {
    code: "BCDFG",
    lang: "fr",
    status: "lobby",
    players: 3,
    maxPlayers: 10,
    minPlayers: 7,
    timers: "standard",
    startsAt: null,
  };

  it("keeps well-formed rooms and drops malformed ones", () => {
    const frame = JSON.stringify({
      t: "lobby",
      serverTime: 1_700_000_000_000,
      rooms: [room, { ...room, code: "bad" }, { ...room, code: "CDFGH", status: "ended" }, "x"],
    });
    expect(parseLobbyMessage(frame)).toEqual({ serverTime: 1_700_000_000_000, rooms: [room] });
  });

  it("ignores anything that is not a lobby frame", () => {
    expect(parseLobbyMessage("pong")).toBeNull();
    expect(parseLobbyMessage(JSON.stringify({ t: "other" }))).toBeNull();
    expect(parseLobbyMessage(JSON.stringify({ t: "lobby", rooms: "x", serverTime: 1 }))).toBeNull();
  });

  it("builds the WebSocket URL from the rooms base URL", () => {
    expect(lobbySocketUrl("http://localhost:8787")).toBe("ws://localhost:8787/v1/lobby/ws");
    expect(lobbySocketUrl("https://rooms.example")).toBe("wss://rooms.example/v1/lobby/ws");
  });
});
