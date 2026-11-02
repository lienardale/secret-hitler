"use client";

/**
 * Registers the service worker (public/sw.js) once the page has loaded, in
 * production only. In development it removes any worker left by a production
 * build on the same origin, so `next dev` never runs behind a cache.
 * Renders nothing.
 */
import { useEffect } from "react";

export const SERVICE_WORKER_URL = "/sw.js";

export function ServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;

    if (process.env.NODE_ENV !== "production") {
      container
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => undefined);
      return;
    }

    const register = () => {
      // updateViaCache "none": the browser never reads sw.js from its HTTP cache.
      container
        .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
