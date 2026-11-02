import type { GameState } from "./types";

export const STATE_VERSION = 1;

/**
 * Upgrade a stored game state to the current schema. Games in progress survive
 * a deploy, so every change to `GameState` must add a step here.
 */
export function migrate(raw: unknown): GameState {
  if (typeof raw !== "object" || raw === null || (raw as { v?: unknown }).v !== STATE_VERSION) {
    throw new Error("migrate: unsupported game state version");
  }
  return raw as GameState;
}
