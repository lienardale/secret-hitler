/**
 * Builders for room-core tests: a room with a fake clock and deterministic
 * randomness, and helpers to drive a game through the core.
 */
import { legalActions, pendingActors, seededRandom, type Action, type GameState } from "@sh/engine";
import type { ClientMessage, CreateRoomRequest } from "@sh/protocol";

import { secretHitler } from "../../src/games/secret-hitler/adapter";
import {
  RoomCore,
  createRoomState,
  type JoinIdentity,
  type RoomDeps,
} from "../../src/room/room-core";

export type Core = ReturnType<typeof makeRoom>["core"];

export const T0 = 1_800_000_000_000;

export function guest(n: number, extra: Partial<JoinIdentity> = {}): JoinIdentity {
  return { kind: "guest", sub: `g${n}`, name: `Player ${n}`, mod: false, blocks: [], ...extra };
}

export function user(n: number, extra: Partial<JoinIdentity> = {}): JoinIdentity {
  return { kind: "user", sub: `u${n}`, name: `User ${n}`, mod: false, blocks: [], ...extra };
}

export function testDeps(seed = 1): RoomDeps {
  let pid = 0;
  let uuid = 0;
  return {
    random: seededRandom(seed),
    seed: () => [seed, seed + 1, seed + 2, seed + 3],
    pid: () => `p${++pid}`,
    uuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
  };
}

export function makeRoom(
  options: {
    visibility?: "private" | "public";
    settings?: CreateRoomRequest["settings"];
    host?: JoinIdentity;
    seed?: number;
  } = {},
) {
  const visibility = options.visibility ?? "private";
  const host = options.host ?? (visibility === "public" ? user(1) : guest(1));
  const room = createRoomState<GameState>(
    {
      visibility,
      lang: "fr",
      host: { kind: host.kind, sub: host.sub, name: host.name },
      settings: options.settings,
    },
    "BCDFG",
    T0,
  );
  const core = new RoomCore(secretHitler, testDeps(options.seed), room, {
    log: [],
    history: [],
    chat: [],
    online: [],
    now: T0,
  });
  core.drain();
  return { core, room };
}

/** Joins `count` members (guests 1..count, or users for public rooms); returns their pids. */
export function joinAll(core: Core, count: number, now = T0, make = guest): string[] {
  return Array.from({ length: count }, (_, i) => {
    const result = core.join(make(i + 1), now);
    if (!result.ok) throw new Error(`join ${i + 1} refused: ${result.code}`);
    return result.pid;
  });
}

/** A private room with `count` guests joined and the game started by the host (pids[0]). */
export function startedRoom(count = 5, options: Parameters<typeof makeRoom>[0] = {}) {
  const made = makeRoom(options);
  const pids = joinAll(made.core, count);
  const error = made.core.handle(pids[0] as string, { t: "start" }, T0);
  if (error) throw new Error(`start refused: ${error}`);
  return { ...made, pids };
}

export function state(core: Core): GameState {
  const game = core.room.game;
  if (!game) throw new Error("no game");
  return game.state;
}

export function pidAt(core: Core, seat: number): string {
  return core.room.game?.seats[seat] as string;
}

/** The current turn, for action messages. */
export function turn(core: Core): number {
  return core.room.game?.turn ?? 0;
}

export function act(core: Core, seat: number, action: Action, now = T0) {
  const msg: ClientMessage = { t: "action", turn: turn(core), action };
  return core.handle(pidAt(core, seat), msg, now);
}

/** Plays random legal actions through the core until the game ends. Returns moves played. */
export function playToEnd(core: Core, seed = 7, now = T0): number {
  const rand = seededRandom(seed);
  let moves = 0;
  while (core.room.status === "playing") {
    const s = state(core);
    const pending = pendingActors(s);
    const seat = pending[Math.floor(rand() * pending.length)] as number;
    const legal = legalActions(s, seat);
    const action = legal[Math.floor(rand() * legal.length)] as Action;
    const error = act(core, seat, action, now);
    if (error) throw new Error(`legal action refused: ${error}`);
    moves += 1;
    if (moves > 2000) throw new Error("game did not end");
  }
  return moves;
}
