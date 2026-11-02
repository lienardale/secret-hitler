import { SIGNATURE_HEADER, verifyRequest } from "@sh/protocol";
import { describe, expect, it } from "vitest";

import { deliver, retryDelayMs } from "../src/room/outbox";
import type { OutboxItem } from "../src/room/room-state";

const SECRET = "test-rooms-to-web-secret-0123456789abcdef";
const config = { baseUrl: "https://web.test", secret: SECRET };
// The payload's content does not matter to delivery.
const item = { id: "o1", kind: "gameResult", payload: { gameId: "g" } } as unknown as OutboxItem;

function answering(status: number): typeof fetch {
  return () => Promise.resolve(new Response(null, { status }));
}

describe("outbox delivery", () => {
  it("posts the signed payload to the website's results endpoint", async () => {
    let seen: Request | undefined;
    const fetcher: typeof fetch = (input, init) => {
      seen = new Request(input, init);
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    expect(await deliver(item, config, fetcher)).toBe("done");
    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe("https://web.test/api/internal/games");
    const body = (await seen?.text()) ?? "";
    expect(JSON.parse(body)).toEqual(item.payload);
    const parts = { method: "POST", path: "/api/internal/games", body };
    expect(await verifyRequest(SECRET, parts, seen?.headers.get(SIGNATURE_HEADER) ?? null)).toBe(
      true,
    );
  });

  it("posts reports to the website's reports endpoint", async () => {
    let url = "";
    const fetcher: typeof fetch = (input) => {
      url = input instanceof Request ? input.url : String(input);
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    const report = {
      id: "r1",
      kind: "report",
      payload: { reportId: "r" },
    } as unknown as OutboxItem;
    expect(await deliver(report, config, fetcher)).toBe("done");
    expect(url).toBe("https://web.test/api/internal/reports");
  });

  it("is done on 2xx and 409, drops what the website refuses, retries the rest", async () => {
    const outcomes: Record<number, string> = {};
    for (const status of [200, 204, 409, 400, 413, 422, 401, 404, 429, 500, 503]) {
      outcomes[status] = await deliver(item, config, answering(status));
    }
    expect(outcomes).toEqual({
      200: "done",
      204: "done",
      409: "done",
      400: "drop",
      413: "drop",
      422: "drop",
      401: "retry",
      404: "retry",
      429: "retry",
      500: "retry",
      503: "retry",
    });
    const failing: typeof fetch = () => Promise.reject(new TypeError("network down"));
    expect(await deliver(item, config, failing)).toBe("retry");
  });

  it("drops everything when no website is configured", async () => {
    expect(await deliver(item, { ...config, baseUrl: "" }, answering(200))).toBe("drop");
  });

  it("backs off from 30 s, doubling, up to an hour", () => {
    expect([1, 2, 3, 8, 20].map(retryDelayMs)).toEqual([
      30_000, 60_000, 120_000, 3_600_000, 3_600_000,
    ]);
  });
});
