/**
 * Display names, shared by the website (sign-up, guest names) and the rooms
 * Worker (names carried in tickets).
 *
 * Two levels:
 * - `checkDisplayNameShape`: length and characters. The ticket and identity
 *   schemas use only this, so tightening the word lists never locks an
 *   existing account out of its rooms.
 * - `checkDisplayName`: shape, reserved names and the offensive-word filter
 *   (`moderation/filters.ts`). Used whenever a name is chosen.
 */
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from "./constants";
import { isOffensiveName } from "./moderation/filters";
import { RESERVED_NAMES } from "./moderation/words";

/** Letters and digits from any script, plus space, `_`, `.`, `'` and `-` inside the name. */
const NAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} _.'-]*[\p{L}\p{N}])?$/u;

/** Digits commonly typed for letters ("Adm1n", "M0d"). */
const DIGIT_LETTERS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

/** `nameKey` without separators ("Secret_Hitler" → "secrethitler"). */
function squashedKey(name: string): string {
  return nameKey(name).replace(/[\s_.'-]+/g, "");
}

let reserved: Set<string> | undefined;

/** NFKC, trimmed, inner runs of whitespace collapsed to one space. */
export function normalizeDisplayName(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Lowercase, accents removed: used to compare names and spot reserved ones. */
export function nameKey(name: string): string {
  return normalizeDisplayName(name).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Staff and site names, labels the site shows instead of a name ("Joueur
 * supprimé", "Vous") and the game's offices. Compared without case, accents,
 * separators or digit leetspeak, so "Ad-min", "M0D" and "Secret_Hitler" are
 * reserved too; with digits dropped as well, so "Admin 2" is. "Player 12345"
 * (the name moderators give on a forced rename) is not reserved.
 */
export function isReservedName(name: string): boolean {
  reserved ??= new Set(RESERVED_NAMES.map(squashedKey));
  const key = squashedKey(name);
  return (
    reserved.has(key) ||
    reserved.has(key.replace(/\d/g, (digit) => DIGIT_LETTERS[digit] ?? digit)) ||
    reserved.has(key.replace(/\d+/g, ""))
  );
}

export type DisplayNameProblem = "length" | "characters" | "reserved" | "offensive";

/** Length and characters only (what tickets and identities are checked against). */
export function checkDisplayNameShape(raw: string): "length" | "characters" | null {
  const name = normalizeDisplayName(raw);
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX) return "length";
  if (!NAME_PATTERN.test(name)) return "characters";
  return null;
}

/** Every rule for a name being chosen: shape, reserved names, offensive words. */
export function checkDisplayName(raw: string): DisplayNameProblem | null {
  const shape = checkDisplayNameShape(raw);
  if (shape) return shape;
  const name = normalizeDisplayName(raw);
  if (isReservedName(name)) return "reserved";
  if (isOffensiveName(name)) return "offensive";
  return null;
}
