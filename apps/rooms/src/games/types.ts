/**
 * The seam between rooms and a game's rules. Rooms, chat and timers only talk
 * to the game through this interface, so another hidden-role game could plug
 * in later without touching the room code. There is one implementation today
 * (games/secret-hitler/adapter.ts).
 */
import type { GameResult, TimerPreset } from "@sh/protocol";

export type GameViewer = number | "spectator";

/** 128-bit seed from the platform's crypto RNG. */
export type GameSeed = readonly [number, number, number, number];

export interface GameViewOptions {
  stopped?: boolean;
}

export type ApplyOutcome<S, E> = { ok: true; state: S; events: E[] } | { ok: false; code: string };

export interface GameModule<S, A, V, E> {
  readonly id: "secret-hitler";
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** Version of the stored state, recorded with game logs. */
  readonly stateVersion: number;

  /** Validates an action received from a client; null if it is not one. */
  parseAction(raw: unknown): A | null;
  setup(playerCount: number, seed: GameSeed): { state: S; events: E[] };
  apply(state: S, seat: number, action: A): ApplyOutcome<S, E>;
  /**
   * What one viewer may see. The only game data ever sent to a client.
   * `stopped`: the room ended the game early (abandoned), so every role is
   * revealed and nobody may act.
   */
  view(state: S, viewer: GameViewer, options?: GameViewOptions): V;
  eventsFor(events: readonly E[], viewer: GameViewer): E[];
  /** Seats that must act now. */
  pendingActors(state: S): number[];
  /** Action played for a seat that timed out or is away; null if it has nothing to do. */
  defaultAction(state: S, seat: number, rand: () => number): A | null;
  /**
   * Identifies the current decision. It changes when a new decision starts,
   * not when one of several simultaneous actors (voters) acts.
   */
  phaseKey(state: S): string;
  /** Time allowed for the current decision, or null (timers off, or game over). */
  decisionMs(state: S, preset: TimerPreset): number | null;
  /** Whether a seat (or a spectator, `null`) may chat in the current phase. */
  canChat(state: S, seat: number | null): boolean;
  isAlive(state: S, seat: number): boolean;
  /** The result once the game is over, with the winning seats. */
  result(state: S): { result: GameResult; winners: number[] } | null;
  roleOf(state: S, seat: number): "liberal" | "fascist" | "hitler";
  /** Upgrades a stored state after a deploy. */
  migrate(raw: unknown): S;
}
