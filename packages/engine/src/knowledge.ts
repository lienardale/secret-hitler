import { HITLER_KNOWS_FASCISTS_MAX_PLAYERS } from "./constants";
import type { GameState, Party, Role, Seat } from "./types";

export function partyOf(role: Role): Party {
  return role === "liberal" ? "liberal" : "fascist";
}

/**
 * Roles a seat knows from the night phase (its own included):
 * - Liberals know only themselves.
 * - Fascists know every fascist and Hitler.
 * - Hitler knows the fascists only in 5–6 player games.
 * Investigation results are separate (see `GameState.investigations`).
 */
export function knownRoles(state: GameState, seat: Seat): { seat: Seat; role: Role }[] {
  const own = state.roles[seat];
  const seesTeam =
    own === "fascist" ||
    (own === "hitler" && state.playerCount <= HITLER_KNOWS_FASCISTS_MAX_PLAYERS);
  return state.roles.flatMap((role, other) =>
    other === seat || (seesTeam && role !== "liberal") ? [{ seat: other, role }] : [],
  );
}
