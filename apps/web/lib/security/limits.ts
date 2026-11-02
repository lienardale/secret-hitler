/**
 * The website's in-memory rate limits (per server instance): cheap floods
 * only. Guest cookies and room creation moved to the database limiter
 * (`DB_RATE_LIMITS.guestCookiePerIp`, `roomCreationPerIdentity`,
 * `roomCreationPerIp` in ./db-rate-limit.ts), so they hold across instances.
 */
import { memoryRateLimiter } from "./rate-limit";

/** Room tickets, per identity: reconnections are cheap, floods are not. */
export const ticketLimit = memoryRateLimiter({ limit: 60, windowMs: 60_000 });
/** Join-by-code lookups, per IP (stops code enumeration). */
export const joinLookupLimit = memoryRateLimiter({ limit: 30, windowMs: 10 * 60_000 });
