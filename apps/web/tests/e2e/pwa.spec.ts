/**
 * Installable web app: manifest and icons, the service worker (registration,
 * headers, offline page) and a clean console under the CSP.
 *
 * Needs a production build (the worker registers only in production). Uses no
 * database, so it also runs against a deployed site:
 *   PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app \
 *     npx playwright test pwa.spec.ts --project=desktop-chromium
 */
import { expect, test, type Page } from "@playwright/test";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/**
 * Collects console errors, uncaught exceptions and CSP violations from the
 * first script on. Call `snapshot()` before each navigation away (violations
 * are kept in the page) and at the end.
 */
async function watchForErrors(page: Page): Promise<{ snapshot: () => Promise<string[]> }> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const store = window as unknown as { __cspViolations?: string[] };
    store.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      store.__cspViolations?.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return {
    async snapshot() {
      const violations = await page.evaluate(() => {
        const store = window as unknown as { __cspViolations?: string[] };
        const found = store.__cspViolations ?? [];
        store.__cspViolations = [];
        return found;
      });
      errors.push(...violations.map((v) => `csp: ${v}`));
      return [...errors];
    },
  };
}

/** Waits until the service worker is active and controls the page. */
async function waitForServiceWorker(page: Page): Promise<string> {
  const scriptURL = await page.evaluate(async () => {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("no service worker after 30 s")), 30_000),
    );
    const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
    return registration.active?.scriptURL ?? "";
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return scriptURL;
}

test("the manifest parses and every icon it lists is served", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = (await response.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: ManifestIcon[];
  };
  expect(manifest).toMatchObject({ name: "Secret Hitler", start_url: "/", display: "standalone" });
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "512x512 maskable",
  ]);
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src, { maxRedirects: 0 });
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()["content-type"], icon.src).toBe(icon.type);
  }
});

test("pages link the manifest, the favicon and the iOS icon", async ({ page, request }) => {
  await page.goto("/fr");
  const manifest = page.locator('link[rel="manifest"]');
  await expect(manifest).toHaveCount(1);
  await expect(manifest).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "Secret Hitler",
  );

  const links = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        rel: element.getAttribute("rel"),
        href: element.getAttribute("href") ?? "",
        type: element.getAttribute("type"),
      })),
    );
  expect(links.map((link) => link.rel)).toEqual(["icon", "icon", "apple-touch-icon"]);
  for (const link of links) {
    const response = await request.get(link.href, { maxRedirects: 0 });
    expect(response.status(), link.href).toBe(200);
    expect(response.headers()["content-type"], link.href).toContain(link.type ?? "image/");
  }
});

test("the service worker script and the offline page are served as expected", async ({
  request,
}) => {
  const sw = await request.get("/sw.js", { maxRedirects: 0 });
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(sw.headers()["content-type"]).toContain("javascript");

  const offline = await request.get("/offline.html", { maxRedirects: 0 });
  expect(offline.status()).toBe(200);
  expect(offline.headers()["content-type"]).toContain("text/html");
  const html = await offline.text();
  expect(html).toContain("Vous êtes hors ligne");
  expect(html).toContain("You are offline");
  // Self-contained: no external stylesheet, script, image or font.
  expect(html).not.toMatch(/(src|href)="https?:/);
});

test("the home page has no console error or CSP violation, worker included", async ({
  page,
  browserName,
}) => {
  const watcher = await watchForErrors(page);
  await page.goto("/fr");
  expect(await waitForServiceWorker(page)).toMatch(/\/sw\.js$/);
  await watcher.snapshot();
  // Again, now through the worker.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Secret Hitler" })).toBeVisible();

  if (browserName === "chromium") {
    // Chrome's own manifest parser (what "Install app" reads), under manifest-src.
    const cdp = await page.context().newCDPSession(page);
    const { url, errors } = (await cdp.send("Page.getAppManifest", {})) as {
      url: string;
      errors: Array<{ message: string }>;
    };
    expect(url).toMatch(/\/manifest\.webmanifest$/);
    expect(errors.map((e) => e.message)).toEqual([]);
    await cdp.detach();
  }

  expect(await watcher.snapshot()).toEqual([]);
});

test("without network, a page shows the offline page instead of an error", async ({
  page,
  context,
}) => {
  await page.goto("/fr");
  await waitForServiceWorker(page);

  await context.setOffline(true);
  try {
    await page.goto("/fr");
    await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Réessayer/ })).toHaveAttribute("href", "/");
    expect(new URL(page.url()).pathname).toBe("/fr");
  } finally {
    await context.setOffline(false);
  }

  // Back online, a reload brings the real page back (HTML is never served from a cache).
  // The offline page reloads by itself on the `online` event, which Chromium fires only
  // sometimes when Playwright restores the network: the test reloads too, and whichever
  // navigation starts second aborts the other (ERR_ABORTED), which is fine.
  await page.reload().catch(() => undefined);
  await expect(page.getByRole("heading", { level: 1, name: "Secret Hitler" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Vous êtes hors ligne" })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/fr");
});
