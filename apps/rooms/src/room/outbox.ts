/**
 * Delivery to the website: game results and player reports (M5). Items are
 * written to the room's outbox table in the same transaction as the change
 * that produced them, then posted from the alarm (never from the message path
 * or an RPC) and retried with backoff for 3 days. The website is idempotent
 * on `gameId` / `reportId`, so a repeated delivery is harmless.
 */
import { SIGNATURE_HEADER, signRequest } from "@sh/protocol";

import type { OutboxItem } from "./room-state";

export const OUTBOX_GIVE_UP_MS = 3 * 24 * 60 * 60_000;
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** The website refused the payload itself: sending it again cannot help. */
const DROP_STATUSES: ReadonlySet<number> = new Set([400, 413, 422]);

export const PATHS: Record<OutboxItem["kind"], string> = {
  gameResult: "/api/internal/games",
  report: "/api/internal/reports",
};

/** Delay before retry number `attempts` (1, 2, …): 30 s, 1 min, 2 min… capped at 1 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * - `done`: delivered (2xx), or the website already has it (409);
 * - `drop`: will never succeed (payload refused with 400/422, over the size cap with 413,
 *   or no website configured);
 * - `retry`: network error, timeout, 5xx, or anything else.
 */
export type Delivery = "done" | "drop" | "retry";

export async function deliver(
  item: OutboxItem,
  config: { baseUrl: string; secret: string },
  fetcher: typeof fetch = fetch,
): Promise<Delivery> {
  if (config.baseUrl === "") return "drop";
  const path = PATHS[item.kind];
  const body = JSON.stringify(item.payload);
  try {
    const signature = await signRequest(config.secret, { method: "POST", path, body });
    const response = await fetcher(new URL(path, config.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok || response.status === 409) return "done";
    if (DROP_STATUSES.has(response.status)) return "drop";
    return "retry";
  } catch {
    return "retry";
  }
}
