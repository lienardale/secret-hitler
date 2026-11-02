"use client";

/**
 * React side of the turn alerts (turn-alert.ts): the alert bound to this
 * page's `document` / `navigator`, and the per-browser vibration preference.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { browserStorage } from "@/lib/room-client/mute";

import {
  canVibrate,
  createTurnAlert,
  loadVibrationPreference,
  saveVibrationPreference,
  VIBRATION_PREFERENCE_KEY,
  type TurnAlert,
} from "./turn-alert";

/** Calls `onChange` whenever the `<title>` changes (Next.js rewrites it on refresh). */
function watchTitle(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.head, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}

/**
 * Prefixes the tab title while `decisionKey` is not null and vibrates once
 * per new key (when `vibrate`, supported and after a user gesture). The
 * prefix goes away when the key turns null or the component unmounts.
 */
export function useTurnAlert(decisionKey: string | null, prefix: string, vibrate: boolean): void {
  const alert = useRef<TurnAlert | null>(null);

  useEffect(() => {
    alert.current ??= createTurnAlert({ document, navigator, watchTitle });
    alert.current.update(decisionKey, { prefix, vibrate });
  }, [decisionKey, prefix, vibrate]);

  useEffect(() => () => alert.current?.release(), []);
}

// ------------------------------------------------------- the preference ----

const listeners = new Set<() => void>();
/** Used when storage refused the write: the choice then lasts until the page closes. */
let unsaved: boolean | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === VIBRATION_PREFERENCE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getPreference = () => unsaved ?? loadVibrationPreference(browserStorage());
const getServerPreference = () => true;

const noSubscription = () => () => {};
/** Desktop Chrome has `navigator.vibrate` but no motor: the switch is for touch devices only. */
const getSupport = () =>
  typeof navigator !== "undefined" && canVibrate(navigator) && navigator.maxTouchPoints > 0;
const getServerSupport = () => false;

export interface VibrationPreference {
  /** A touch device that can vibrate (false on the server, on desktops and on iOS Safari). */
  supported: boolean;
  /** The player wants turn vibrations (default true). */
  on: boolean;
  setOn(on: boolean): void;
}

export function useVibrationPreference(): VibrationPreference {
  const on = useSyncExternalStore(subscribe, getPreference, getServerPreference);
  const supported = useSyncExternalStore(noSubscription, getSupport, getServerSupport);
  const setOn = useCallback((value: boolean) => {
    unsaved = saveVibrationPreference(browserStorage(), value) ? null : value;
    for (const listener of listeners) listener();
  }, []);
  return { supported, on, setOn };
}
