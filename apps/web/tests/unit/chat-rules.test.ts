import { describe, expect, it } from "vitest";
import {
  apply,
  legalActions,
  playRandomGame,
  seededRandom,
  viewFor,
  type Action,
  type GameState,
} from "@sh/engine";

import { chatBlockReason } from "../../components/room/chat-rules";

/** A fresh 5-player game moved to the President's discard. */
function inLegislativeSession(): GameState {
  let { state } = playRandomGame(5, [7, 7, 7, 7], seededRandom(1), { maxActions: 0 });
  const nominate = legalActions(state, state.president)[0] as Action;
  let result = apply(state, { seat: state.president, action: nominate });
  if (!result.ok) throw new Error(result.error.code);
  state = result.state;
  for (let seat = 0; seat < 5; seat++) {
    result = apply(state, { seat, action: { type: "vote", ja: true } });
    if (!result.ok) throw new Error(result.error.code);
    state = result.state;
  }
  return state;
}

describe("who may chat", () => {
  it("lets everyone talk outside a game", () => {
    expect(chatBlockReason("lobby", null)).toBeNull();
    const state = inLegislativeSession();
    expect(chatBlockReason("ended", viewFor(state, "spectator"))).toBeNull();
  });

  it("silences spectators, the dead, and the government in session", () => {
    const state = inLegislativeSession();
    expect(state.phase.kind).toBe("presidentDiscard");
    if (state.phase.kind !== "presidentDiscard") return;
    expect(chatBlockReason("playing", viewFor(state, "spectator"))).toBe("spectator");
    expect(chatBlockReason("playing", viewFor(state, state.president))).toBe("silence");
    expect(chatBlockReason("playing", viewFor(state, state.phase.chancellor))).toBe("silence");
    const bystander = [0, 1, 2, 3, 4].find(
      (s) =>
        s !== state.president &&
        s !== (state.phase.kind === "presidentDiscard" ? state.phase.chancellor : -1),
    ) as number;
    expect(chatBlockReason("playing", viewFor(state, bystander))).toBeNull();
    const dead = {
      ...state,
      alive: state.alive.map((alive, s) => (s === bystander ? false : alive)),
    };
    expect(chatBlockReason("playing", viewFor(dead, bystander))).toBe("dead");
  });
});
