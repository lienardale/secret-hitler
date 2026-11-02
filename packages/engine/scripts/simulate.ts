/**
 * Play many random games against the engine and report invariant violations
 * and outcome statistics.
 *
 *   npm -w @sh/engine run simulate -- --games 20000 [--seed 42] [--players 7]
 *
 * Exits with status 1 if any game breaks an invariant or fails to end.
 */
import { parseArgs } from "node:util";

import { outcome, playRandomGame, seededRandom, type WinReason } from "../src/index";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "2000" },
    seed: { type: "string", default: "1" },
    players: { type: "string" },
  },
});

const games = Number(values.games);
const baseSeed = Number(values.seed);
const fixedPlayers = values.players === undefined ? null : Number(values.players);
if (!Number.isInteger(games) || games <= 0) throw new Error("--games must be a positive integer");

interface Stats {
  games: number;
  actions: number;
  maxActions: number;
  reasons: Record<WinReason, number>;
}

const emptyStats = (): Stats => ({
  games: 0,
  actions: 0,
  maxActions: 0,
  reasons: { liberalPolicies: 0, hitlerExecuted: 0, fascistPolicies: 0, hitlerElected: 0 },
});

const byPlayers = new Map<number, Stats>();
const failures: string[] = [];
const started = performance.now();
const random = seededRandom(baseSeed);
const uint32 = (): number => Math.floor(random() * 0x100000000);

for (let i = 0; i < games; i++) {
  const playerCount = fixedPlayers ?? 5 + (i % 6);
  const seed = [uint32(), uint32(), uint32(), uint32()] as const;
  const result = playRandomGame(playerCount, seed, seededRandom(uint32()), {
    checkInvariants: true,
    maxActions: 1000,
  });
  if (result.violations.length > 0) {
    failures.push(`game ${i} (${playerCount}p, seed ${seed.join(",")}): ${result.violations[0]}`);
    continue;
  }
  const end = outcome(result.state);
  if (end === null) continue;
  const stats = byPlayers.get(playerCount) ?? emptyStats();
  stats.games += 1;
  stats.actions += result.moves.length;
  stats.maxActions = Math.max(stats.maxActions, result.moves.length);
  stats.reasons[end.reason] += 1;
  byPlayers.set(playerCount, stats);
}

const pct = (n: number, total: number): string => `${((100 * n) / total).toFixed(1)}%`;
const rows = [...byPlayers.entries()]
  .sort(([a], [b]) => a - b)
  .map(([players, s]) => ({
    players,
    games: s.games,
    "5 liberal": pct(s.reasons.liberalPolicies, s.games),
    "Hitler shot": pct(s.reasons.hitlerExecuted, s.games),
    "6 fascist": pct(s.reasons.fascistPolicies, s.games),
    "Hitler elected": pct(s.reasons.hitlerElected, s.games),
    "avg actions": Math.round(s.actions / s.games),
    "max actions": s.maxActions,
  }));

console.log(
  `Played ${games} random games in ${((performance.now() - started) / 1000).toFixed(1)} s`,
);
console.log("(random play, so outcomes say nothing about real game balance)");
console.table(rows);

if (failures.length > 0) {
  console.error(`\n${failures.length} game(s) broke an invariant:`);
  for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("No invariant violations.");
