/**
 * Turn alerts: when a decision starts for this player (a new room `turn` with
 * something in `view.me.legal`), the tab title gets a prefix ("● À vous ·
 * Salle BCDFG") for as long as the decision is open, and the phone vibrates
 * once. Useful when the tab is in the background or the phone lies on the table.
 *
 * Pure apart from the `document` / `navigator` it is given, so jsdom tests can
 * drive it; `use-turn-alert.ts` wires it to React and the browser.
 *
 * - The prefix is added once (never stacked) and removed when the decision
 *   ends, or when the alert is released (the room unmounts).
 * - Vibration: once per decision, only where `navigator.vibrate` exists and
 *   the page has had a user gesture (`navigator.userActivation.hasBeenActive`;
 *   browsers refuse to vibrate before one), and only if the player has not
 *   turned it off (`loadVibrationPreference`).
 *
 * Web Push (alerts with the page closed) is a later step: see the M6 notes.
 */
import type { KeyValueStorage } from "@/lib/room-client/mute";

/** Buzz, pause, buzz (ms). */
export const VIBRATION_PATTERN: readonly number[] = [200, 100, 200];

/** Per-browser preference: absent = vibrate, "off" = do not. */
export const VIBRATION_PREFERENCE_KEY = "sh:turn-alert:vibrate";

const SEPARATOR = " · ";

/** `title` with `prefix` in front, unless it already has it. */
export function prefixedTitle(title: string, prefix: string): string {
  const head = prefix + SEPARATOR;
  return title.startsWith(head) ? title : head + title;
}

/** `title` without `prefix` (as added by `prefixedTitle`). */
export function unprefixedTitle(title: string, prefix: string): string {
  const head = prefix + SEPARATOR;
  let result = title;
  // Strip repeats too, should anything ever have stacked them.
  while (result.startsWith(head)) result = result.slice(head.length);
  return result;
}

/** The parts of `navigator` used here. */
export interface AlertNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
  userActivation?: { readonly hasBeenActive: boolean };
}

/** The parts of `document` used here. */
export interface AlertDocument {
  title: string;
}

export function canVibrate(nav: AlertNavigator | undefined | null): boolean {
  return typeof nav?.vibrate === "function";
}

/** True unless this browser stored "off". Storage may be missing or throw. */
export function loadVibrationPreference(storage: KeyValueStorage | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(VIBRATION_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Stores the preference; false when storage is missing or refused the write. */
export function saveVibrationPreference(storage: KeyValueStorage | null, on: boolean): boolean {
  if (!storage) return false;
  try {
    if (on) storage.removeItem(VIBRATION_PREFERENCE_KEY);
    else storage.setItem(VIBRATION_PREFERENCE_KEY, "off");
    return true;
  } catch {
    return false;
  }
}

export interface TurnAlertOptions {
  /** The localized title prefix, e.g. "● À vous". */
  prefix: string;
  /** The player's preference (vibration also needs support and a past user gesture). */
  vibrate: boolean;
}

export interface TurnAlert {
  /**
   * `key` identifies the open decision (`${turn}:${kind}`), null when there is
   * none. Call it on every change; repeated calls with the same key do nothing
   * new (other players' votes leave the turn unchanged).
   */
  update(key: string | null, options: TurnAlertOptions): void;
  /** Removes the prefix and stops watching the title. The alert can be updated again. */
  release(): void;
}

export interface TurnAlertEnv {
  document: AlertDocument;
  navigator?: AlertNavigator | null;
  /**
   * Calls `onChange` when something else rewrites the title (Next.js metadata
   * after a refresh), so the prefix comes back. Returns a function to stop.
   */
  watchTitle?: (onChange: () => void) => () => void;
}

export function createTurnAlert(env: TurnAlertEnv): TurnAlert {
  const doc = env.document;
  /** The prefix currently in the title, if any. */
  let applied: string | null = null;
  let current: string | null = null;
  /** Kept across `release()`: a remount during the same decision does not buzz again. */
  let vibrated: string | null = null;
  let unwatch: (() => void) | null = null;

  const setTitle = (title: string) => {
    if (doc.title !== title) doc.title = title;
  };

  const removePrefix = () => {
    if (applied !== null) setTitle(unprefixedTitle(doc.title, applied));
    applied = null;
  };

  const applyPrefix = (prefix: string) => {
    if (applied !== null && applied !== prefix) removePrefix();
    setTitle(prefixedTitle(doc.title, prefix));
    applied = prefix;
  };

  const vibrate = () => {
    const nav = env.navigator;
    if (!nav || !canVibrate(nav) || nav.userActivation?.hasBeenActive !== true) return;
    try {
      nav.vibrate?.([...VIBRATION_PATTERN]);
    } catch {
      // Refused (policy, battery saver): the title prefix is enough.
    }
  };

  const stopWatching = () => {
    unwatch?.();
    unwatch = null;
  };

  return {
    update(key, { prefix, vibrate: wantsVibration }) {
      if (key === null) {
        current = null;
        stopWatching();
        removePrefix();
        return;
      }
      applyPrefix(prefix);
      if (!unwatch && env.watchTitle) {
        unwatch = env.watchTitle(() => {
          if (applied !== null) setTitle(prefixedTitle(doc.title, applied));
        });
      }
      if (key !== current) {
        current = key;
        if (key !== vibrated) {
          vibrated = key;
          if (wantsVibration) vibrate();
        }
      }
    },
    release() {
      current = null;
      stopWatching();
      removePrefix();
    },
  };
}
