import {
  ROLE_TABLE,
  pendingActors,
  seededRandom,
  viewFor,
  type GameEvent,
  type PlayerCount,
  type PlayerView,
} from "@sh/engine";
import { describe, expect, it } from "vitest";

import { FIXTURE_NAMES, buildFixture, newGame, randomStep } from "@/lib/game-fixtures";

import { announceLines } from "./EventLog";
import { currentInvestigation } from "./InvestigationPanel";
import type { LogLine } from "./log-text";
import { ballotOrder } from "./motion";
import {
  policiesLeft,
  teamComposition,
  voteTally,
  voteWarnings,
  waitingSeats,
  type GameT,
} from "./status";

const sorted = (seats: readonly number[]) => [...seats].sort((a, b) => a - b);

describe("waitingSeats", () => {
  it.each([
    ["nominate", "president"],
    ["presidentDiscard", "president"],
    ["chancellorEnact", "chancellor"],
    ["vetoResponse", "president"],
    ["investigate", "president"],
    ["peek", "president"],
    ["specialElection", "president"],
    ["execute", "president"],
  ] as const)("%s waits for the %s only", (name, who) => {
    const fixture = buildFixture(name, { players: name === "peek" ? 5 : 7, seed: 3 });
    const view = viewFor(fixture.game.state, "spectator");
    const phase = fixture.game.state.phase;
    const expected =
      who === "president" ? view.president : "chancellor" in phase ? phase.chancellor : -1;
    expect(waitingSeats(view)).toEqual([expected]);
  });

  it("waits for the living players who have not voted during a vote", () => {
    const fixture = buildFixture("vote", { players: 7, seed: 3 });
    const view = viewFor(fixture.game.state, "spectator");
    const expected = view.seats.filter((s) => s.alive && s.hasVoted === false).map((s) => s.seat);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(7);
    expect(waitingSeats(view)).toEqual(expected);
  });

  it("waits for nobody once the game is over or stopped", () => {
    expect(waitingSeats(viewFor(buildFixture("liberalWin").game.state, "spectator"))).toEqual([]);
    const vote = buildFixture("vote").game.state;
    expect(waitingSeats(viewFor(vote, "spectator", { stopped: true }))).toEqual([]);
  });

  it("is exactly the engine's pending actors, for every fixture and seat", () => {
    for (const name of FIXTURE_NAMES) {
      const { state } = buildFixture(name, { players: 7, seed: 3 }).game;
      for (const viewer of ["spectator", 0, 3] as const) {
        expect(sorted(waitingSeats(viewFor(state, viewer)))).toEqual(sorted(pendingActors(state)));
      }
    }
  });

  it("matches the pending actors at every step of random games", () => {
    for (const players of [5, 8, 10] as const) {
      const rand = seededRandom(players);
      let game = newGame(players, players * 13);
      for (let step = randomStep(game, rand); step; step = randomStep(game, rand)) {
        game = step.game;
        expect(sorted(waitingSeats(viewFor(game.state, "spectator")))).toEqual(
          sorted(pendingActors(game.state)),
        );
      }
    }
  });
});

describe("voteWarnings", () => {
  const base = viewFor(buildFixture("vote", { players: 7, seed: 3 }).game.state, "spectator");
  const view = (patch: Partial<PlayerView>): PlayerView => ({ ...base, ...patch });

  it("warns about Hitler from the 3rd fascist policy and about chaos at 2 failed elections", () => {
    expect(voteWarnings(view({ fascist: 2, tracker: 1 }))).toEqual([]);
    expect(voteWarnings(view({ fascist: 3, tracker: 0 }))).toEqual(["hitlerZone"]);
    expect(voteWarnings(view({ fascist: 1, tracker: 2 }))).toEqual(["chaos"]);
    expect(voteWarnings(view({ fascist: 4, tracker: 2 }))).toEqual(["hitlerZone", "chaos"]);
  });

  it("applies to nominations and votes only", () => {
    expect(voteWarnings(view({ fascist: 3, tracker: 2, phase: { kind: "nominate" } }))).toEqual([
      "hitlerZone",
      "chaos",
    ]);
    expect(
      voteWarnings(
        view({ fascist: 3, tracker: 2, phase: { kind: "presidentDiscard", chancellor: 1 } }),
      ),
    ).toEqual([]);
  });

  it("holds in the dedicated fixtures", () => {
    for (const players of [5, 7, 10]) {
      const zone = buildFixture("voteHitlerZone", { players, seed: 3 }).game.state;
      expect(voteWarnings(viewFor(zone, "spectator"))).toContain("hitlerZone");
      const chaos = buildFixture("voteChaos", { players, seed: 3 }).game.state;
      expect(voteWarnings(viewFor(chaos, "spectator"))).toContain("chaos");
    }
  });
});

describe("counters", () => {
  it("team composition follows the official role table", () => {
    const expected: Record<PlayerCount, [number, number]> = {
      5: [3, 1],
      6: [4, 1],
      7: [4, 2],
      8: [5, 2],
      9: [5, 3],
      10: [6, 3],
    };
    for (const [count, [liberal, fascist]] of Object.entries(expected)) {
      const n = Number(count) as PlayerCount;
      expect(teamComposition(n)).toEqual({ liberal, fascist });
      expect(ROLE_TABLE[n]).toEqual({ liberal, fascist });
    }
  });

  it("policies left are the 6 L / 11 F deck minus the board, chaos included", () => {
    const { state } = buildFixture("chaos", { players: 7, seed: 3 }).game;
    const view = viewFor(state, "spectator");
    expect(policiesLeft(view)).toEqual({ liberal: 6 - view.liberal, fascist: 11 - view.fascist });
    // Pile + discard + nothing in hand during a nomination = every policy not on the board.
    const left = policiesLeft(view);
    expect(left.liberal + left.fascist).toBe(view.deckCount + view.discardCount);
  });

  it("counts a vote's ballots", () => {
    expect(voteTally([true, false, null, true, true])).toEqual({ ja: 3, nein: 1 });
  });
});

describe("ballotOrder", () => {
  it("ranks living voters clockwise from the President", () => {
    expect(ballotOrder([true, false, null, true, false], 3)).toEqual([2, 3, null, 0, 1]);
    expect(ballotOrder([true, true, true], 0)).toEqual([0, 1, 2]);
  });
});

describe("currentInvestigation", () => {
  const result: GameEvent = {
    type: "investigationResult",
    president: 2,
    target: 4,
    party: "fascist",
  };
  const round = (president: number): GameEvent => ({
    type: "roundStarted",
    president,
    special: false,
  });

  it("keeps the result through the round that follows the investigation", () => {
    const log: GameEvent[] = [
      round(2),
      { type: "playerInvestigated", president: 2, target: 4 },
      result,
      round(3),
    ];
    expect(currentInvestigation(log, 2)).toEqual({ index: 2, target: 4, party: "fascist" });
    expect(
      currentInvestigation([...log, { type: "chancellorNominated", president: 3, nominee: 5 }], 2),
    ).not.toBeNull();
    expect(currentInvestigation([...log, round(4)], 2)).toBeNull();
  });

  it("is only for the investigating President", () => {
    expect(currentInvestigation([result, round(3)], 1)).toBeNull();
    expect(currentInvestigation([round(0)], 2)).toBeNull();
  });
});

describe("announceLines", () => {
  const t = ((key: string) => (key === "log.privateArrived" ? "PRIVATE" : key)) as unknown as GameT;
  const line = (text: string, extra: Partial<LogLine> = {}): LogLine => ({
    text,
    private: false,
    ...extra,
  });

  it("says a private line arrived, once, without its content", () => {
    expect(
      announceLines(
        [
          line("Ada investigates Basile."),
          line("Basile is Fascist.", { private: true }),
          line("Round", { round: true }),
        ],
        t,
      ),
    ).toBe("Ada investigates Basile. PRIVATE");
    expect(
      announceLines([line("a", { private: true }), line("b", { private: true }), null], t),
    ).toBe("PRIVATE");
  });
});
