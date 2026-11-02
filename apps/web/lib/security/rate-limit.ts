/**
 * Sliding-window rate limits, in memory.
 *
 * Per server instance: on Vercel each warm function has its own counters, so
 * a determined client spread over instances gets more. That is acceptable
 * for M3 (guest cookies and tickets); M4 moves the limits that guard abuse
 * (sign-up, reports) to Postgres.
 */
export interface RateLimiter {
  /** Records a hit for `key`; `ok: false` when over the limit (the hit is not counted). */
  take(key: string, now?: number): { ok: true } | { ok: false; retryAfterMs: number };
}

const MAX_KEYS = 10_000;

export function memoryRateLimiter(options: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < options.windowMs);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: options.windowMs - (now - (recent[0] as number)) };
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      // Bounded memory: forget the oldest keys first (Map keeps insertion order).
      while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value as string);
      return { ok: true };
    },
  };
}
