/**
 * Account display names: the protocol's shape rules (2–20 characters,
 * reserved names) plus uniqueness in Postgres on both the name (citext) and
 * its `nameKey` (accents and case removed), so "Élise" and "elise" cannot
 * both exist. The offensive-word filter joins in M5.
 */
import {
  checkDisplayName,
  nameKey,
  normalizeDisplayName,
  type DisplayNameProblem,
} from "@sh/protocol";

import { isUniqueViolation } from "@/lib/db/errors";

/** One rename per 30 days (onboarding does not count). */
export const RENAME_INTERVAL_MS = 30 * 24 * 60 * 60_000;

export type DisplayNameCheck =
  { ok: true; name: string; key: string } | { ok: false; error: `name_${DisplayNameProblem}` };

export function validateDisplayName(raw: unknown): DisplayNameCheck {
  const name = normalizeDisplayName(typeof raw === "string" ? raw : "");
  const problem = checkDisplayName(name);
  if (problem) return { ok: false, error: `name_${problem}` };
  return { ok: true, name, key: nameKey(name) };
}

/** A P2002 on either display-name column. */
export function isDisplayNameTaken(error: unknown): boolean {
  return isUniqueViolation(error, "displayname");
}

/** When the next rename is allowed, or null if it is now. */
export function nextRenameAt(changedAt: Date | null, now = new Date()): Date | null {
  if (!changedAt) return null;
  const next = new Date(changedAt.getTime() + RENAME_INTERVAL_MS);
  return next.getTime() > now.getTime() ? next : null;
}
