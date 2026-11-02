/**
 * Display names, shared by the website (sign-up, guest names) and the rooms
 * Worker (names carried in tickets). The offensive-word filter arrives with
 * moderation (M5); this file covers shape and reserved names.
 */
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from "./constants";

/** Letters and digits from any script, plus space, `_`, `.`, `'` and `-` inside the name. */
const NAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} _.'-]*[\p{L}\p{N}])?$/u;

const RESERVED = new Set([
  "admin",
  "administrateur",
  "administrator",
  "moderateur",
  "moderator",
  "modo",
  "system",
  "systeme",
  "secret hitler",
  "hitler",
  "staff",
  "support",
]);

/** NFKC, trimmed, inner runs of whitespace collapsed to one space. */
export function normalizeDisplayName(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Lowercase, accents removed: used to compare names and spot reserved ones. */
export function nameKey(name: string): string {
  return normalizeDisplayName(name).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function isReservedName(name: string): boolean {
  return RESERVED.has(nameKey(name));
}

export type DisplayNameProblem = "length" | "characters" | "reserved";

export function checkDisplayName(raw: string): DisplayNameProblem | null {
  const name = normalizeDisplayName(raw);
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX) return "length";
  if (!NAME_PATTERN.test(name)) return "characters";
  if (isReservedName(name)) return "reserved";
  return null;
}
