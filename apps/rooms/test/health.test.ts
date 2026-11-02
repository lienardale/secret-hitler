import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("rooms worker skeleton", () => {
  it("answers /health", async () => {
    const res = await exports.default.fetch("https://rooms.test/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, protocol: 1 });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await exports.default.fetch("https://rooms.test/nope");
    expect(res.status).toBe(404);
  });

  it("has no room behind a code nobody created", async () => {
    expect(await env.GAME_ROOM.getByName("BCDFG").info()).toBeNull();
  });
});
