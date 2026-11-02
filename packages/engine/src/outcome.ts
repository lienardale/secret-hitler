import type { GameState, Party, WinReason } from "./types";

export function outcome(state: GameState): { winner: Party; reason: WinReason } | null {
  if (state.phase.kind !== "over") return null;
  return { winner: state.phase.winner, reason: state.phase.reason };
}
