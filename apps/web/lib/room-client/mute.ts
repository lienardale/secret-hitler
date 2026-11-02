/**
 * Muted members: a choice of this browser only. The room never knows; the
 * chat panel just hides their messages (history and live).
 *
 * Kept per room in `localStorage` under `sh:muted:<CODE>`, as the room ids
 * (`pid`) muted and when the list last changed. Room ids are room-scoped and
 * stable while the member stays, so a list older than `MUTE_TTL_MS` is
 * dropped. Storage may be missing or throw (private windows, blocked site
 * data): every access is guarded and muting then lasts until the page closes.
 */

/** The part of `Storage` used here, so tests can pass a plain object. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A room lives hours, not days: older lists are forgotten. */
export const MUTE_TTL_MS = 7 * 24 * 60 * 60_000;
/** More than a full room (10 players, 30 spectators) ever holds. */
export const MUTE_MAX = 100;

const PID = /^[A-Za-z0-9_-]{1,32}$/;

export function mutedStorageKey(code: string): string {
  return `sh:muted:${code}`;
}

/** `window.localStorage`, or null where reading it throws or there is no window. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The members muted in room `code`; empty when nothing (valid and recent) is stored. */
export function loadMuted(
  storage: KeyValueStorage | null,
  code: string,
  now: number = Date.now(),
): ReadonlySet<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(mutedStorageKey(code));
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as { pids?: unknown; at?: unknown };
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.at !== "number" ||
      !Array.isArray(parsed.pids) ||
      now - parsed.at > MUTE_TTL_MS
    ) {
      storage.removeItem(mutedStorageKey(code));
      return new Set();
    }
    return new Set(
      parsed.pids
        .filter((pid): pid is string => typeof pid === "string" && PID.test(pid))
        .slice(0, MUTE_MAX),
    );
  } catch {
    return new Set();
  }
}

/** Stores the list (or removes the key when it is empty). Never throws. */
export function saveMuted(
  storage: KeyValueStorage | null,
  code: string,
  muted: Iterable<string>,
  now: number = Date.now(),
): void {
  if (!storage) return;
  const pids = [...muted].slice(0, MUTE_MAX);
  try {
    if (pids.length === 0) storage.removeItem(mutedStorageKey(code));
    else storage.setItem(mutedStorageKey(code), JSON.stringify({ pids, at: now }));
  } catch {
    // Quota or blocked storage: the mute still holds for this page.
  }
}

/** A copy of `muted` with `pid` added (`on`) or removed. */
export function withMuted(
  muted: ReadonlySet<string>,
  pid: string,
  on: boolean,
): ReadonlySet<string> {
  if (muted.has(pid) === on) return muted;
  const next = new Set(muted);
  if (on) next.add(pid);
  else next.delete(pid);
  return next;
}
