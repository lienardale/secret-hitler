"use client";

import { useEffect, useState } from "react";

/** Whole seconds left before `deadline`, on the server's clock (never negative). */
export function remainingSeconds(deadline: number, clockOffset: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - (now + clockOffset)) / 1000));
}

/** "0:45", "1:30", "12:05". */
export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Seconds left before `deadline` (ms since epoch, server clock), re-rendering
 * about once a second. Null without a deadline, and during the server render
 * and hydration (the clock is only read in the browser).
 */
export function useRemainingSeconds(deadline: number | null, clockOffset: number): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    // Sampled 4×/s so the display never skips a second; React skips renders when unchanged.
    const tick = () => setSeconds(remainingSeconds(deadline, clockOffset, Date.now()));
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [deadline, clockOffset]);
  return deadline === null ? null : seconds;
}
