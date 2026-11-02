/*
 * Secret Hitler service worker (registered by components/pwa/ServiceWorker.tsx,
 * production only). Deliberately minimal:
 *
 * - Page navigations always go to the network. Only when the network fails is
 *   the precached /offline.html shown. HTML pages are NEVER cached, so a deploy
 *   reaches everyone at the next page load.
 * - Hashed /_next/static/ files (immutable) are served cache-first.
 * - Everything else is left alone (no respondWith): /api/* (auth included),
 *   non-GET requests, RSC and data fetches, cross-origin requests (the rooms
 *   Worker), WebSockets (never seen by a service worker anyway).
 * - Nothing with personal data is ever written to a cache.
 *
 * Updates: the cache names carry VERSION (bump it when this file changes how it
 * caches); a new worker takes over at once (skipWaiting + clients.claim) and
 * deletes every other cache. The file itself is served with
 * `Cache-Control: no-cache` (next.config.ts), so browsers see a new one at once.
 * Emergency off switch: replace this file with one that calls
 * `self.registration.unregister()` on activate.
 */
"use strict";

const VERSION = "v1";
const OFFLINE_CACHE = `sh-offline-${VERSION}`;
const STATIC_CACHE = `sh-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
/** Old builds' chunks pile up across deploys: keep the most recent entries only. */
const MAX_STATIC_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      // `reload` skips the HTTP cache: a new worker always stores the current page.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== OFFLINE_CACHE && name !== STATIC_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkOrOfflinePage(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, request));
  }
});

/** A page: the network's answer, whatever it is; the offline page only if there is none. */
async function networkOrOfflinePage(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
    if (offline) return offline;
    throw error;
  }
}

/** An immutable, content-hashed build file. */
async function cacheFirst(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) {
    const saved = cache
      .put(request, response.clone())
      .then(() => trim(cache))
      .catch(() => undefined);
    try {
      event.waitUntil(saved);
    } catch {
      // The event is already settled: the write still runs, unguarded.
    }
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}
