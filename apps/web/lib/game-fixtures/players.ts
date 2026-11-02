/**
 * Fake room members for the /dev/table sandbox and the component tests.
 * A `PlayerSlot` is what the room sends for each seat (index = seat number).
 */
import type { Seat } from "@sh/engine";
import type { PlayerSlot } from "@sh/protocol";

export const FAKE_NAMES = [
  "Ada",
  "Basile",
  "Chloé",
  "Dmitri",
  "Elif",
  "Fatou",
  "Gaspard",
  "Hana",
  "Igor",
  "Jeanne",
] as const;

export interface FakePlayerOptions {
  /** Seats whose browser is disconnected. */
  offline?: readonly Seat[];
  /** Seats played automatically (public games, away too long). */
  afk?: readonly Seat[];
}

export function fakePlayers(count: number, options: FakePlayerOptions = {}): PlayerSlot[] {
  const offline = new Set(options.offline ?? []);
  const afk = new Set(options.afk ?? []);
  return Array.from({ length: count }, (_, seat) => ({
    pid: `p${seat}`,
    name: FAKE_NAMES[seat % FAKE_NAMES.length] ?? `Player ${seat + 1}`,
    guest: seat % 3 === 1,
    connected: !offline.has(seat),
    afk: afk.has(seat),
  }));
}
