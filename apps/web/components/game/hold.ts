"use client";

import { useState } from "react";

/**
 * Classes for a hold-to-reveal button: no callout menu, text selection or tap
 * highlight on a long press (`.sh-hold` in game.css). Add `touch-none` when
 * the button must not scroll the page while held (the role card), or
 * `touch-manipulation` inside a scrolling list (event-log lines).
 */
export const HOLD = "sh-hold cursor-pointer select-none";

/**
 * Press-and-hold privacy for secrets on screen (the role card, private log
 * lines, the investigation result), for players sitting side by side.
 *
 * - Pointer / touch: revealed only while pressed and held.
 * - Keyboard: Enter or Space toggles it (`aria-pressed`).
 * - Hidden again when focus leaves the button.
 *
 * Spread `buttonProps` on a `<button type="button">`; render the secret only
 * while `revealed` is true, so it is not in the DOM otherwise.
 */
export function useHoldToReveal() {
  const [held, setHeld] = useState(false);
  const [toggled, setToggled] = useState(false);
  const release = () => setHeld(false);
  const revealed = held || toggled;

  const buttonProps = {
    "aria-pressed": revealed,
    onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setHeld(true);
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    onContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
      event.preventDefault();
    },
    onClick(event: React.MouseEvent<HTMLButtonElement>) {
      // Pointer clicks are handled by press-and-hold; keyboard clicks (detail 0) toggle.
      if (event.detail === 0) setToggled((value) => !value);
    },
    onBlur() {
      setToggled(false);
      setHeld(false);
    },
  };
  return { revealed, buttonProps };
}
