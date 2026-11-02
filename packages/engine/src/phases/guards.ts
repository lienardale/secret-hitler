import type { GameState, Seat } from "../types";

export function isSeat(state: GameState, value: unknown): value is Seat {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < state.playerCount;
}

export function isIndex(value: unknown, size: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < size;
}
