/**
 * Installable web app: manifest, icons (drawn with ImageResponse), the
 * favicon, the service worker's caching rules (run in a fake worker scope),
 * and the headers / CSP in next.config.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, dynamicParams, generateStaticParams } from "@/app/app-icons/[file]/route";
import manifest from "@/app/manifest";
import { APP_ICONS, PWA_COLORS, appIconUrl, iconSvg, markExtent } from "@/lib/pwa/icons";

const WEB_ROOT = path.resolve(import.meta.dirname, "../..");

describe("manifest", () => {
  const m = manifest();

  it("describes a standalone app opening on /", () => {
    expect(m).toMatchObject({
      name: "Secret Hitler",
      short_name: "Secret Hitler",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(m.description).toEqual(expect.any(String));
    expect(m).not.toHaveProperty("orientation");
  });

  it("uses the light theme colours, like viewport.themeColor", () => {
    expect(m.background_color).toBe(PWA_COLORS.paper);
    expect(m.theme_color).toBe(PWA_COLORS.paper);
    const layout = readFileSync(path.join(WEB_ROOT, "app/[locale]/layout.tsx"), "utf8");
    expect(layout).toContain(
      `{ media: "(prefers-color-scheme: light)", color: "${PWA_COLORS.paper}" }`,
    );
    const css = readFileSync(path.join(WEB_ROOT, "styles/globals.css"), "utf8");
    expect(css).toContain(`--color-paper: ${PWA_COLORS.paper};`);
    expect(css).toContain(`--color-ink: ${PWA_COLORS.ink};`);
  });

  it("lists PNG icons 192 and 512 (any) and a maskable 512", () => {
    expect(m.icons).toEqual([
      { src: "/app-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/app-icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });

  it("only points at icons the route serves, with extensions the locale proxy skips", () => {
    const served = generateStaticParams().map((params) => appIconUrl(params));
    expect(dynamicParams).toBe(false);
    for (const icon of m.icons ?? []) {
      expect(served).toContain(icon.src);
      // proxy.ts skips every path with a dot: no redirect to /fr/…
      expect(icon.src).toMatch(/\.png$/);
    }
  });
});

describe("icons", () => {
  it.each(APP_ICONS)("$file is a $size px PNG of the mark", async (icon) => {
    const response = await GET(new Request(`http://localhost${appIconUrl(icon)}`), {
      params: Promise.resolve({ file: icon.file }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = decodePng(Buffer.from(await response.arrayBuffer()));
    expect([png.width, png.height]).toEqual([icon.size, icon.size]);

    // The mark is drawn (not a blank image): the liberal card on the left, the
    // fascist card on the right, sampled under each card's emblem.
    const s = icon.size / 64;
    const scale = icon.variant === "maskable" ? 0.7 : 0.8;
    const y = Math.round(32 * s + 12 * scale * s);
    const left = png.pixel(Math.round((32 - 10.5 * scale) * s), y);
    const right = png.pixel(Math.round((32 + 10.5 * scale) * s), y);
    expectColor(left, PWA_COLORS.liberal);
    expectColor(right, PWA_COLORS.fascist);

    // Corners: transparent around the rounded tile; full-bleed ink otherwise.
    const corner = png.pixel(1, 1);
    if (icon.variant === "any") expect(corner[3]).toBe(0);
    else expectColor(corner, PWA_COLORS.ink);
  });

  it("keeps the maskable mark inside the central 80 % circle", () => {
    expect(markExtent("maskable")).toBeLessThan(0.4 * 64);
    expect(markExtent("any")).toBeLessThan(32);
  });

  it("refuses an unknown icon", async () => {
    const response = await GET(new Request("http://localhost/app-icons/nope.png"), {
      params: Promise.resolve({ file: "nope.png" }),
    });
    expect(response.status).toBe(404);
  });

  it("serves the same drawing as the SVG favicon (app/icon.svg)", () => {
    const favicon = readFileSync(path.join(WEB_ROOT, "app/icon.svg"), "utf8");
    // If this fails, rewrite app/icon.svg with the output of iconSvg("any").
    expect(favicon).toBe(iconSvg("any"));
  });
});

describe("service worker (public/sw.js)", () => {
  const ORIGIN = "https://sh.example";
  const SOURCE = readFileSync(path.join(WEB_ROOT, "public/sw.js"), "utf8");

  interface FakeRequest {
    url: string;
    method: string;
    mode: string;
  }

  function req(pathOrUrl: string, init: Partial<Omit<FakeRequest, "url">> = {}): FakeRequest {
    return {
      url: new URL(pathOrUrl, ORIGIN).href,
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
    };
  }

  const urlOf = (input: string | { url: string }) =>
    new URL(typeof input === "string" ? input : input.url, ORIGIN).href;

  function load() {
    const listeners = new Map<string, (event: unknown) => void>();
    const stores = new Map<string, Map<string, Response>>();
    const writes: string[] = [];
    const network = vi.fn(async (input: string | { url: string }): Promise<Response> => {
      const url = urlOf(input);
      if (url.endsWith("/offline.html")) {
        return new Response("<h1>offline page</h1>", { headers: { "content-type": "text/html" } });
      }
      return new Response(`network ${url}`, { status: 200 });
    });

    const openStore = (name: string) => {
      let entries = stores.get(name);
      if (!entries) stores.set(name, (entries = new Map()));
      const store = entries;
      return {
        add: vi.fn(async (input: string | { url: string }) => {
          writes.push(urlOf(input));
          store.set(urlOf(input), await network(input));
        }),
        put: vi.fn(async (input: string | { url: string }, response: Response) => {
          writes.push(urlOf(input));
          store.set(urlOf(input), response);
        }),
        match: vi.fn(async (input: string | { url: string }) => store.get(urlOf(input))?.clone()),
        keys: vi.fn(async () => [...store.keys()].map((url) => ({ url }))),
        delete: vi.fn(async (input: string | { url: string }) => store.delete(urlOf(input))),
      };
    };

    const caches = {
      open: vi.fn(async (name: string) => openStore(name)),
      keys: vi.fn(async () => [...stores.keys()]),
      delete: vi.fn(async (name: string) => stores.delete(name)),
      match: vi.fn(async (input: string | { url: string }, options?: { cacheName?: string }) => {
        const names = options?.cacheName ? [options.cacheName] : [...stores.keys()];
        for (const name of names) {
          const hit = stores.get(name)?.get(urlOf(input));
          if (hit) return hit.clone();
        }
        return undefined;
      }),
    };

    const self = {
      location: new URL("/sw.js", ORIGIN),
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
      skipWaiting: vi.fn(async () => undefined),
      clients: { claim: vi.fn(async () => undefined) },
    };

    // Relative URLs resolve against the worker's location, as in a browser.
    class WorkerRequest extends Request {
      constructor(input: string | URL, init?: RequestInit) {
        super(new URL(input, ORIGIN), init);
      }
    }

    runInNewContext(SOURCE, {
      self,
      caches,
      fetch: network,
      Request: WorkerRequest,
      Response,
      URL,
    });

    async function lifecycle(type: "install" | "activate") {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
    }

    function fetchEvent(request: FakeRequest) {
      let response: Promise<Response> | undefined;
      const pending: Promise<unknown>[] = [];
      listeners.get("fetch")?.({
        request,
        respondWith: (r: Promise<Response>) => {
          response = Promise.resolve(r);
          pending.push(response);
        },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      return {
        handled: response !== undefined,
        async response() {
          const r = await response;
          // Let the cache writes started during the event finish.
          for (let i = 0; i < pending.length; i += 1) await pending[i];
          return r;
        },
      };
    }

    return { self, caches, stores, writes, network, lifecycle, fetchEvent };
  }

  let sw: ReturnType<typeof load>;
  beforeEach(() => {
    sw = load();
  });

  it("precaches only the offline page on install, then takes over at once", async () => {
    await sw.lifecycle("install");
    expect(sw.writes).toEqual([`${ORIGIN}/offline.html`]);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it("deletes every other cache on activate and claims open pages", async () => {
    await sw.lifecycle("install");
    sw.stores.set("sh-static-v0", new Map());
    sw.stores.set("someone-else", new Map());
    await sw.lifecycle("activate");
    expect([...sw.stores.keys()].every((name) => name.endsWith("-v1"))).toBe(true);
    expect(sw.stores.has("sh-offline-v1")).toBe(true);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("sends pages to the network and never caches them", async () => {
    await sw.lifecycle("install");
    sw.writes.length = 0;
    for (const page of ["/", "/fr", "/en/room/ABCDE", "/fr/profil"]) {
      const event = sw.fetchEvent(req(page, { mode: "navigate" }));
      expect(event.handled).toBe(true);
      expect(await (await event.response())?.text()).toBe(`network ${ORIGIN}${page}`);
    }
    // An HTTP error is the server's answer: passed through, not replaced.
    sw.network.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const failing = await sw.fetchEvent(req("/fr", { mode: "navigate" })).response();
    expect(failing?.status).toBe(503);
    expect(sw.writes).toEqual([]);
  });

  it("shows the offline page only when the network fails", async () => {
    await sw.lifecycle("install");
    sw.network.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const response = await sw.fetchEvent(req("/fr/salle/ABCDE", { mode: "navigate" })).response();
    expect(await response?.text()).toBe("<h1>offline page</h1>");
  });

  it("leaves API, auth, non-GET, cross-origin and data requests alone", () => {
    const untouched = [
      req("/api/auth/session"),
      req("/api/auth/signout", { mode: "navigate" }),
      req("/api/auth/callback/credentials", { method: "POST", mode: "navigate" }),
      req("/api/rooms/ABCDE/ticket", { method: "POST" }),
      req("/api/internal/games", { method: "POST" }),
      req("/fr", { method: "POST", mode: "navigate" }), // server action
      req("/fr/jouer?_rsc=abc"), // client-side navigation data
      req("/manifest.webmanifest"),
      req("/sw.js"),
      req("https://rooms.example/health"),
      req("https://rooms.example/_next/static/chunks/x.js"),
      req("wss://rooms.example/rooms/ABCDE"),
    ];
    for (const request of untouched) {
      expect(sw.fetchEvent(request).handled, request.url).toBe(false);
    }
    expect(sw.network).not.toHaveBeenCalled();
  });

  it("serves hashed build files cache-first", async () => {
    const chunk = req("/_next/static/chunks/app-3f2a1b.js", { mode: "no-cors" });
    const first = await sw.fetchEvent(chunk).response();
    expect(await first?.text()).toBe(`network ${chunk.url}`);
    expect(sw.writes).toEqual([chunk.url]);

    sw.network.mockClear();
    const second = await sw.fetchEvent(chunk).response();
    expect(await second?.text()).toBe(`network ${chunk.url}`);
    expect(sw.network).not.toHaveBeenCalled();

    sw.network.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    await sw.fetchEvent(req("/_next/static/chunks/gone.js")).response();
    expect(sw.writes).toEqual([chunk.url]);
  });

  it("keeps the build-file cache bounded", async () => {
    for (let i = 0; i < 305; i += 1) {
      await sw.fetchEvent(req(`/_next/static/chunks/${i}.js`)).response();
    }
    const store = sw.stores.get("sh-static-v1");
    expect(store?.size).toBe(300);
    expect(store?.has(`${ORIGIN}/_next/static/chunks/0.js`)).toBe(false);
    expect(store?.has(`${ORIGIN}/_next/static/chunks/304.js`)).toBe(true);
  });

  it("writes to a cache in exactly one place, for build files only", () => {
    expect(SOURCE.match(/\.put\(/g)).toHaveLength(1);
    expect(SOURCE.match(/\.add\(/g)).toHaveLength(1);
    expect(SOURCE).not.toMatch(/addAll|navigationPreload/);
  });
});

describe("next.config.ts", () => {
  it("adds manifest-src and worker-src to the CSP and serves sw.js uncached", async () => {
    const { default: config } = await import("@/next.config");
    const rules = (await config.headers?.()) ?? [];
    const all = rules.find((rule) => rule.source === "/(.*)");
    const csp = all?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("img-src 'self' data:");

    const sw = rules.find((rule) => rule.source === "/sw.js");
    const cacheControl = sw?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(cacheControl).toContain("no-cache");
  });
});

/* ------------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Minimal PNG reader (8-bit RGB / RGBA, no interlace): enough to sample pixels. */
function decodePng(buffer: Buffer) {
  expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data.readUInt8(8)).toBe(8); // bit depth
      colorType = data.readUInt8(9);
      expect(data.readUInt8(12)).toBe(0); // no interlace
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  expect([2, 6]).toContain(colorType);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(y * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const value = raw.readUInt8(y * (stride + 1) + 1 + x);
      const a = x >= channels ? pixels.readUInt8(y * stride + x - channels) : 0;
      const b = y > 0 ? pixels.readUInt8((y - 1) * stride + x) : 0;
      const c = x >= channels && y > 0 ? pixels.readUInt8((y - 1) * stride + x - channels) : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels.writeUInt8((value + predicted) & 0xff, y * stride + x);
    }
  }
  return {
    width,
    height,
    pixel(x: number, y: number): number[] {
      const start = y * stride + x * channels;
      const rgba = [...pixels.subarray(start, start + channels)];
      return channels === 4 ? rgba : [...rgba, 255];
    },
  };
}

/** An opaque pixel within a few levels of `hex` on each channel. */
function expectColor(rgba: number[], hex: string): void {
  const expected = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const close = rgba[3] === 255 && expected.every((v, i) => Math.abs(v - (rgba[i] ?? -1)) <= 6);
  expect(close, `rgba(${rgba.join(", ")}) should be ${hex}`).toBe(true);
}
