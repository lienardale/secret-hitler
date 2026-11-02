import { describe, expect, it } from "vitest";

import { knownRoles, partyOf } from "../../src/knowledge";
import { makeState } from "../helpers/builders";

describe("night phase knowledge", () => {
  it("liberals only know themselves", () => {
    const state = makeState({ playerCount: 7 });
    expect(knownRoles(state, 4)).toEqual([{ seat: 4, role: "liberal" }]);
  });

  it("fascists know every fascist and Hitler", () => {
    const state = makeState({ playerCount: 9 }); // 0 = Hitler, 1–3 fascists
    expect(knownRoles(state, 2)).toEqual([
      { seat: 0, role: "hitler" },
      { seat: 1, role: "fascist" },
      { seat: 2, role: "fascist" },
      { seat: 3, role: "fascist" },
    ]);
  });

  it.each([5, 6] as const)("Hitler knows the fascist in a %i-player game", (playerCount) => {
    const state = makeState({ playerCount });
    expect(knownRoles(state, 0)).toEqual([
      { seat: 0, role: "hitler" },
      { seat: 1, role: "fascist" },
    ]);
  });

  it.each([7, 8, 9, 10] as const)("Hitler knows no one in a %i-player game", (playerCount) => {
    const state = makeState({ playerCount });
    expect(knownRoles(state, 0)).toEqual([{ seat: 0, role: "hitler" }]);
  });

  it("Hitler belongs to the fascist party", () => {
    expect(partyOf("hitler")).toBe("fascist");
    expect(partyOf("fascist")).toBe("fascist");
    expect(partyOf("liberal")).toBe("liberal");
  });
});
