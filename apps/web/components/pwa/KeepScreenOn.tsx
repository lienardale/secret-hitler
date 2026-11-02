"use client";

/**
 * Keeps the screen awake while `active` (for example during a game), with the
 * Screen Wake Lock API. Renders nothing.
 *
 * The browser drops the lock whenever the page is hidden, so it is requested
 * again each time the page becomes visible. Released when `active` turns false
 * or on unmount. Silently does nothing where the API is missing (older Safari,
 * Firefox before 126) or the request is refused (battery saver, policy).
 */
import { useEffect } from "react";

export function KeepScreenOn({ active }: { active: boolean }): null {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator) || !navigator.wakeLock) {
      return;
    }
    const wakeLock = navigator.wakeLock;
    let sentinel: WakeLockSentinel | null = null;
    let requesting = false;
    let disposed = false;

    const acquire = async () => {
      if (disposed || requesting || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      requesting = true;
      try {
        const lock = await wakeLock.request("screen");
        if (disposed) {
          await lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Refused or unsupported: the screen just follows the device settings.
      } finally {
        requesting = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquire();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      if (held && !held.released) held.release().catch(() => undefined);
    };
  }, [active]);

  return null;
}
