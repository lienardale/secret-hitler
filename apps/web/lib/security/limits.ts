/** The website's rate limits (docs/plan.md § Moderation), one limiter per purpose. */
import { memoryRateLimiter } from "./rate-limit";

const HOUR = 60 * 60_000;

/** New guest cookies, per IP. */
export const guestCookieLimit = memoryRateLimiter({ limit: 20, windowMs: HOUR });
/** Rooms created, per guest and per IP. */
export const roomCreationLimit = memoryRateLimiter({ limit: 10, windowMs: HOUR });
/** Room tickets, per guest: reconnections are cheap, floods are not. */
export const ticketLimit = memoryRateLimiter({ limit: 60, windowMs: 60_000 });
/** Join-by-code lookups, per IP (stops code enumeration). */
export const joinLookupLimit = memoryRateLimiter({ limit: 30, windowMs: 10 * 60_000 });
