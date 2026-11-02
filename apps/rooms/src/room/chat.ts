/**
 * Chat rate limits, per member:
 * - at most 3 messages in 2 s and 5 in 10 s;
 * - public rooms add a slow mode: 2 s between two messages;
 * - 8 refused messages within 30 s is flooding: the room closes the socket.
 *   A message refused for its content (slur filter) counts as sent *and* as
 *   refused (`strike`), so spamming slurs is never free.
 *
 * Kept in memory only: a room that hibernates forgets recent timestamps,
 * which at worst lets a few extra messages through.
 */
const BURST = { count: 3, windowMs: 2_000 };
const SUSTAINED = { count: 5, windowMs: 10_000 };
export const PUBLIC_SLOW_MODE_MS = 2_000;
const FLOOD = { strikes: 8, windowMs: 30_000 };

export type ChatVerdict = "ok" | "too_fast" | "flood";

export class ChatLimiter {
  private sent = new Map<string, number[]>();
  private refused = new Map<string, number[]>();

  check(pid: string, now: number, slowModeMs: number): ChatVerdict {
    const sent = (this.sent.get(pid) ?? []).filter((t) => now - t < SUSTAINED.windowMs);
    const inBurst = sent.filter((t) => now - t < BURST.windowMs).length;
    const last = sent.at(-1);
    const allowed =
      sent.length < SUSTAINED.count &&
      inBurst < BURST.count &&
      (last === undefined || now - last >= slowModeMs);

    if (allowed) {
      sent.push(now);
      this.sent.set(pid, sent);
      return "ok";
    }
    this.sent.set(pid, sent);
    return this.strike(pid, now) ? "flood" : "too_fast";
  }

  /** Records a refused message. True when the member is now flooding. */
  strike(pid: string, now: number): boolean {
    const refused = [...(this.refused.get(pid) ?? []), now].filter((t) => now - t < FLOOD.windowMs);
    this.refused.set(pid, refused);
    return refused.length >= FLOOD.strikes;
  }

  forget(pid: string): void {
    this.sent.delete(pid);
    this.refused.delete(pid);
  }
}
