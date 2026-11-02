"use client";

/**
 * /dev/table sandbox: the real rules engine runs in the browser, holding the
 * full secret state, and `GameTable` gets `viewFor(state, viewer)` exactly as
 * a room would send it. Dev-only (the page 404s without ENABLE_TEST_PAGES),
 * so its own controls are in plain English.
 */
import {
  eventsFor,
  isPlayerCount,
  legalActions,
  pendingActors,
  seededRandom,
  viewFor,
  type Action,
  type GameState,
  type PlayerCount,
  type Seat,
  type Viewer,
} from "@sh/engine";
import { useEffect, useMemo, useState } from "react";

import { GameTable } from "@/components/game/GameTable";
import {
  FIXTURE_NAMES,
  PLAY_TARGETS,
  buildFixture,
  fakePlayers,
  fixtureDescription,
  isPlayTarget,
  matchesTarget,
  newGame,
  play,
  playUntil,
  randomStep,
  type FixtureName,
  type LocalGame,
  type PlayTarget,
} from "@/lib/game-fixtures";

export interface SandboxConfig {
  players: number;
  seed: number;
  fixture: FixtureName;
  /** null: the fixture's most interesting seat. */
  viewer: Viewer | null;
}

const TIMER_MS = 45_000;

interface Sandbox {
  playerCount: PlayerCount;
  seed: number;
  fixture: FixtureName | null;
  game: LocalGame;
  history: LocalGame[];
  viewer: Viewer;
  turn: number;
  timed: boolean;
  deadline: number | null;
  offline: Seat[];
  afk: Seat[];
  message: string | null;
}

/** Changes whenever a new decision starts (not at each vote), like the room's `turn`. */
function decisionKey(state: GameState): string {
  const phase = state.phase;
  const extra =
    phase.kind === "executive"
      ? phase.power
      : phase.kind === "chancellorEnact"
        ? String(phase.vetoRefused)
        : "";
  return `${phase.kind}:${state.president}:${extra}:${state.liberal + state.fascist}:${state.tracker}`;
}

function clampViewer(viewer: Viewer | null, state: GameState, fallback: Seat | null): Viewer {
  if (viewer === "spectator") return viewer;
  if (viewer !== null && viewer >= 0 && viewer < state.playerCount) return viewer;
  return fallback ?? 0;
}

function load(config: SandboxConfig, now: number): Sandbox {
  const fixture = buildFixture(config.fixture, { players: config.players, seed: config.seed });
  return {
    playerCount: fixture.playerCount,
    seed: fixture.seed,
    fixture: config.fixture,
    game: fixture.game,
    history: [],
    viewer: clampViewer(config.viewer, fixture.game.state, fixture.focusSeat),
    turn: 1,
    timed: fixture.timed,
    deadline: fixture.timed ? now + TIMER_MS : null,
    offline: fixture.offline,
    afk: fixture.afk,
    message:
      fixture.seed !== config.seed
        ? `Seed ${config.seed} did not reach "${config.fixture}"; using seed ${fixture.seed}.`
        : null,
  };
}

/** Move on to a new game state: bump the turn and restart the timer on a new decision. */
function advance(sb: Sandbox, game: LocalGame, follow: boolean, message: string | null): Sandbox {
  const newDecision = decisionKey(game.state) !== decisionKey(sb.game.state);
  let viewer = sb.viewer;
  if (follow && viewer !== "spectator" && legalActions(game.state, viewer).length === 0) {
    viewer = pendingActors(game.state)[0] ?? viewer;
  }
  return {
    ...sb,
    game,
    history: [...sb.history, sb.game].slice(-200),
    viewer,
    turn: newDecision ? sb.turn + 1 : sb.turn,
    deadline: sb.timed && newDecision ? Date.now() + TIMER_MS : sb.deadline,
    message,
  };
}

const FIELD =
  "rounded-md border-2 border-rule bg-paper px-2 py-1 text-ink focus-visible:outline-2 focus-visible:outline-ink";
const BTN =
  "rounded-md border-2 border-ink bg-paper px-3 py-1 font-display tracking-wide hover:bg-paper-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";

export function TableSandbox({ initial }: { initial: SandboxConfig }) {
  // The deadline is only shown after hydration (the countdown reads the clock in an effect).
  const [sb, setSb] = useState<Sandbox>(() => load(initial, Date.now()));
  const [follow, setFollow] = useState(true);
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<PlayTarget>("execute");
  const [chat, setChat] = useState("");

  const { state } = sb.game;
  const view = useMemo(() => viewFor(state, sb.viewer), [state, sb.viewer]);
  const log = useMemo(() => eventsFor(sb.game.events, sb.viewer), [sb.game.events, sb.viewer]);
  const players = useMemo(
    () => fakePlayers(sb.playerCount, { offline: sb.offline, afk: sb.afk }),
    [sb.playerCount, sb.offline, sb.afk],
  );
  const actors = pendingActors(state);

  // Keep the URL deep-linkable (players, seed, fixture, seat).
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("players", String(sb.playerCount));
    url.searchParams.set("seed", String(sb.seed));
    if (sb.fixture) url.searchParams.set("fixture", sb.fixture);
    else url.searchParams.delete("fixture");
    url.searchParams.set("seat", String(sb.viewer));
    window.history.replaceState(window.history.state, "", url);
  }, [sb.playerCount, sb.seed, sb.fixture, sb.viewer]);

  const rand = () => seededRandom(sb.seed * 7919 + sb.game.events.length);

  const onAction = (action: Action) => {
    if (sb.viewer === "spectator") return;
    const result = play(sb.game, { seat: sb.viewer, action });
    setSb((current) =>
      result.ok
        ? advance(current, result.game, follow, null)
        : { ...current, message: `Refused: ${result.error}` },
    );
  };

  const randomMove = () => {
    const step = randomStep(sb.game, rand());
    if (!step) return setSb((c) => ({ ...c, message: "The game is over." }));
    setSb((c) =>
      advance(c, step.game, follow, `Seat ${step.move.seat}: ${JSON.stringify(step.move.action)}`),
    );
  };

  const playToTarget = () => {
    const result = playUntil(sb.game, rand(), (s) => matchesTarget(s, target), 1000);
    setSb((c) =>
      advance(
        c,
        result.game,
        true,
        result.reached
          ? `Reached "${target}" after ${result.steps} moves.`
          : `"${target}" not reached (${result.steps} moves; game over or not on this board).`,
      ),
    );
  };

  const reload = (config: Partial<SandboxConfig>) =>
    setSb(
      load(
        {
          players: config.players ?? sb.playerCount,
          seed: config.seed ?? sb.seed,
          fixture: config.fixture ?? sb.fixture ?? "start",
          viewer: config.viewer ?? null,
        },
        Date.now(),
      ),
    );

  const fresh = (players: number, seed: number) => {
    const count: PlayerCount = isPlayerCount(players) ? players : 7;
    setSb({
      playerCount: count,
      seed,
      fixture: null,
      game: newGame(count, seed),
      history: [],
      viewer: sb.viewer === "spectator" ? "spectator" : Math.min(Number(sb.viewer), count - 1),
      turn: 1,
      timed: sb.timed,
      deadline: sb.timed ? Date.now() + TIMER_MS : null,
      offline: [],
      afk: [],
      message: `New game: ${count} players, seed ${seed}.`,
    });
  };

  const undo = () =>
    setSb((c) => {
      const previous = c.history.at(-1);
      if (!previous) return c;
      return {
        ...c,
        game: previous,
        history: c.history.slice(0, -1),
        turn: c.turn + 1,
        message: "Undone.",
      };
    });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4">
      <details open className="mb-4 rounded-xl border-2 border-dashed border-rule p-3 text-sm">
        <summary className="cursor-pointer font-display text-lg tracking-wide">
          Table sandbox (local engine)
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            Players
            <select
              className={FIELD}
              value={sb.playerCount}
              onChange={(e) =>
                sb.fixture
                  ? reload({ players: Number(e.target.value) })
                  : fresh(Number(e.target.value), sb.seed)
              }
            >
              {[5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Seed
            <input
              className={`${FIELD} w-24`}
              type="number"
              value={sb.seed}
              onChange={(e) => {
                const seed = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(seed)) return;
                if (sb.fixture) reload({ seed });
                else fresh(sb.playerCount, seed);
              }}
            />
          </label>
          <label className="flex max-w-full min-w-0 flex-col gap-1">
            Fixture
            <select
              className={`${FIELD} max-w-full`}
              value={sb.fixture ?? ""}
              onChange={(e) => {
                const fixture = e.target.value as FixtureName | "";
                if (fixture) reload({ fixture });
              }}
            >
              <option value="" disabled>
                (free play)
              </option>
              {FIXTURE_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name} — {fixtureDescription(name)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={BTN} onClick={() => fresh(sb.playerCount, sb.seed)}>
            New game
          </button>
          <label className="flex flex-col gap-1">
            View as
            <select
              className={FIELD}
              value={String(sb.viewer)}
              onChange={(e) => {
                const value = e.target.value;
                setSb((c) => ({
                  ...c,
                  viewer: value === "spectator" ? "spectator" : Number(value),
                }));
              }}
            >
              <option value="spectator">Spectator</option>
              {players.map((p, seat) => (
                <option key={seat} value={seat}>
                  {seat} · {p.name} · {state.roles[seat]}
                  {state.alive[seat] ? "" : " (dead)"}
                  {actors.includes(seat) ? " ← to act" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} onClick={randomMove} disabled={actors.length === 0}>
            Random move
          </button>
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              className={BTN}
              onClick={playToTarget}
              disabled={actors.length === 0}
            >
              Play randomly until
            </button>
            <select
              aria-label="Target phase or power"
              className={FIELD}
              value={target}
              onChange={(e) => {
                if (isPlayTarget(e.target.value)) setTarget(e.target.value);
              }}
            >
              {PLAY_TARGETS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </span>
          <button type="button" className={BTN} onClick={undo} disabled={sb.history.length === 0}>
            Undo
          </button>
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow the player to act
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={sb.timed}
              onChange={(e) => {
                const timed = e.target.checked;
                setSb((c) => ({ ...c, timed, deadline: timed ? Date.now() + TIMER_MS : null }));
              }}
            />
            Timer (45 s)
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={pending}
              onChange={(e) => setPending(e.target.checked)}
            />
            Pending (action in flight)
          </label>
        </div>
        <p className="mt-2 text-ink-muted" data-testid="sandbox-status">
          {sb.playerCount} players · seed {sb.seed} · seq {state.seq} · turn {sb.turn} · to act:{" "}
          {actors.length ? actors.map((s) => `${s} ${players[s]?.name}`).join(", ") : "nobody"}
          {sb.message ? ` · ${sb.message}` : ""}
        </p>
      </details>

      <GameTable
        view={view}
        log={log}
        players={players}
        turn={sb.turn}
        deadline={sb.deadline}
        clockOffset={0}
        onAction={onAction}
        pending={pending}
        aside={
          <div className="rounded-xl border-2 border-dashed border-rule p-3 text-sm">
            <p className="font-display text-lg">Chat (sandbox placeholder)</p>
            <label className="mt-2 flex flex-col gap-1">
              Type here: your turn must not steal focus
              <input className={FIELD} value={chat} onChange={(e) => setChat(e.target.value)} />
            </label>
          </div>
        }
      />
    </div>
  );
}
