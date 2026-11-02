import { checkInvariants, pendingActors, seededRandom, viewFor } from "@sh/engine";
import { describe, expect, it } from "vitest";

import {
  FIXTURE_NAMES,
  buildFixture,
  fakePlayers,
  fixturePlayerCount,
  matchesTarget,
  newGame,
  playUntil,
  randomStep,
  seedWords,
  type FixtureName,
} from "./index";

const COUNTS = [5, 6, 7, 8, 9, 10] as const;

describe("buildFixture", () => {
  it.each(FIXTURE_NAMES)("%s is reached for every player count", (name) => {
    for (const players of COUNTS) {
      const fixture = buildFixture(name, { players, seed: 3 });
      expect(fixture.playerCount).toBe(fixturePlayerCount(name, players));
      expect(checkInvariants(fixture.game.state)).toEqual([]);
      if (fixture.focusSeat !== null) {
        expect(fixture.focusSeat).toBeGreaterThanOrEqual(0);
        expect(fixture.focusSeat).toBeLessThan(fixture.playerCount);
      }
    }
  });

  it("is deterministic for a seed", () => {
    const a = buildFixture("veto", { players: 8, seed: 42 });
    const b = buildFixture("veto", { players: 8, seed: 42 });
    expect(b.seed).toBe(a.seed);
    expect(b.game.state).toEqual(a.game.state);
    expect(b.game.events).toEqual(a.game.events);
  });

  it("different seeds give different games", () => {
    const a = buildFixture("nominate", { players: 7, seed: 1 });
    const b = buildFixture("nominate", { players: 7, seed: 2 });
    expect(b.game.state).not.toEqual(a.game.state);
  });

  const expectations: Partial<Record<FixtureName, (f: ReturnType<typeof buildFixture>) => void>> = {
    vote: (f) => {
      const phase = f.game.state.phase;
      expect(phase.kind).toBe("vote");
      if (phase.kind !== "vote") return;
      const cast = phase.votes.filter((v) => v !== null).length;
      expect(cast).toBeGreaterThan(0);
      expect(pendingActors(f.game.state).length).toBeGreaterThan(0);
      expect(f.offline).toHaveLength(1);
      expect(f.afk).toHaveLength(1);
    },
    peek: (f) => {
      expect(f.playerCount).toBeLessThanOrEqual(6);
      expect(viewFor(f.game.state, f.focusSeat as number).me?.peek).toHaveLength(3);
    },
    investigationResult: (f) => {
      expect(viewFor(f.game.state, f.focusSeat as number).me?.investigations).toHaveLength(1);
    },
    dead: (f) => {
      expect(f.game.state.alive[f.focusSeat as number]).toBe(false);
    },
    chaos: (f) => {
      expect(f.game.events.some((e) => e.type === "policyEnacted" && e.byChaos)).toBe(true);
    },
    hitlerElected: (f) => {
      expect(f.game.state.phase).toMatchObject({ kind: "over", reason: "hitlerElected" });
    },
    vetoResponse: (f) => {
      expect(f.game.state.phase.kind).toBe("vetoResponse");
      expect(f.focusSeat).toBe(f.game.state.president);
    },
  };

  it.each(Object.entries(expectations))("%s has the expected shape", (name, check) => {
    check(buildFixture(name as FixtureName, { players: 7, seed: 11 }));
  });
});

describe("local play", () => {
  it("seedWords gives four 32-bit words", () => {
    const words = seedWords(7);
    expect(words).toHaveLength(4);
    for (const word of words) {
      expect(Number.isInteger(word) && word >= 0 && word < 2 ** 32).toBe(true);
    }
  });

  it("random steps reach the end of a game", () => {
    const rand = seededRandom(5);
    let game = newGame(7, 5);
    let steps = 0;
    for (let step = randomStep(game, rand); step; step = randomStep(game, rand)) {
      game = step.game;
      steps++;
    }
    expect(game.state.phase.kind).toBe("over");
    expect(steps).toBeGreaterThan(5);
  });

  it("playUntil stops at a target", () => {
    const result = playUntil(newGame(9, 1), seededRandom(1), (s) =>
      matchesTarget(s, "presidentDiscard"),
    );
    expect(result.reached).toBe(true);
    expect(result.game.state.phase.kind).toBe("presidentDiscard");
  });

  it("fakePlayers marks offline and AFK seats", () => {
    const players = fakePlayers(6, { offline: [2], afk: [4] });
    expect(players.map((p) => p.name)).toEqual([
      "Ada",
      "Basile",
      "Chloé",
      "Dmitri",
      "Elif",
      "Fatou",
    ]);
    expect(players[2]?.connected).toBe(false);
    expect(players[4]?.afk).toBe(true);
    expect(new Set(players.map((p) => p.pid)).size).toBe(6);
  });
});
