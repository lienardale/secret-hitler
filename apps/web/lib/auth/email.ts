/** E-mail addresses: one canonical form for lookups and rate-limit keys. */
import { z } from "zod";

/**
 * `trim().toLowerCase()` only (no dot or plus stripping): the column is
 * `citext`, which compares exactly this way.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z.email().max(254);
