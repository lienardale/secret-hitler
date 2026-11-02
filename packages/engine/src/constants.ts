import type { PlayerCount, Policy, Power } from "./types";

/** Liberals and Fascists per player count, plus one Hitler (official role table). */
export const ROLE_TABLE: Readonly<Record<PlayerCount, { liberal: number; fascist: number }>> = {
  5: { liberal: 3, fascist: 1 },
  6: { liberal: 4, fascist: 1 },
  7: { liberal: 4, fascist: 2 },
  8: { liberal: 5, fascist: 2 },
  9: { liberal: 5, fascist: 3 },
  10: { liberal: 6, fascist: 3 },
};

/** The policy deck: 6 Liberal and 11 Fascist tiles. */
export const DECK_COMPOSITION: Readonly<Record<Policy, number>> = { L: 6, F: 11 };
export const DECK_SIZE = DECK_COMPOSITION.L + DECK_COMPOSITION.F;

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

export const LIBERAL_POLICIES_TO_WIN = 5;
export const FASCIST_POLICIES_TO_WIN = 6;
/** Hitler elected Chancellor once this many fascist policies are on the board wins for the fascists. */
export const HITLER_ZONE = 3;
/** The veto power unlocks once this many fascist policies are on the board. */
export const VETO_UNLOCK = 5;
/** Failed elections in a row before the top policy is enacted automatically. */
export const TRACKER_LIMIT = 3;
/** Hitler knows the fascists only in games of at most this many players. */
export const HITLER_KNOWS_FASCISTS_MAX_PLAYERS = 6;
/** Term limits ignore the last President once this many players (or fewer) are alive. */
export const RELAXED_TERM_LIMIT_ALIVE = 5;

export type PowerBoard = readonly [
  Power | null,
  Power | null,
  Power | null,
  Power | null,
  Power | null,
];

/**
 * Fascist board powers: entry i is granted by the (i+1)-th fascist policy.
 * The 6th fascist policy wins the game, so it has no entry.
 *
 * Keys are plain identifiers on purpose: with keys like "5-6" and "7-8",
 * Turbopack's production minifier (Next 16.4.3) merged two boards and 7–8
 * player games got the 5–6 board in the browser (.debug/004).
 */
export const POWER_BOARDS: Readonly<Record<"small" | "medium" | "large", PowerBoard>> = {
  /** 5 and 6 players. */
  small: [null, null, "peek", "execute", "execute"],
  /** 7 and 8 players. */
  medium: [null, "investigate", "specialElection", "execute", "execute"],
  /** 9 and 10 players. */
  large: ["investigate", "investigate", "specialElection", "execute", "execute"],
};

export function powerBoard(playerCount: PlayerCount): PowerBoard {
  if (playerCount <= 6) return POWER_BOARDS.small;
  if (playerCount <= 8) return POWER_BOARDS.medium;
  return POWER_BOARDS.large;
}

export function isPlayerCount(n: number): n is PlayerCount {
  return Number.isInteger(n) && n >= MIN_PLAYERS && n <= MAX_PLAYERS;
}
