/** Shared class lists for the game controls (token utilities only). */

const FOCUS = "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ink";
const DISABLED = "disabled:cursor-not-allowed disabled:opacity-50";

const BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 py-2 font-display text-lg leading-tight tracking-wide transition-colors ${FOCUS} ${DISABLED}`;

export const BUTTON = {
  solid: `${BTN} border-ink bg-ink text-paper hover:enabled:bg-ink/85`,
  outline: `${BTN} border-ink bg-paper text-ink hover:enabled:bg-paper-raised`,
  danger: `${BTN} border-fascist bg-fascist text-paper hover:enabled:bg-fascist/85`,
} as const;

/** A selectable player in a picker (toggle button). */
export const CHOICE = `min-h-11 truncate rounded-lg border-2 border-rule bg-paper px-3 py-2 text-left font-display text-lg leading-tight transition-colors hover:enabled:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper ${FOCUS} ${DISABLED}`;

/** A Ja!/Nein! ballot button (card proportions come from .sh-ballot in game.css). */
export const BALLOT = `sh-ballot flex aspect-[5/4] flex-col items-center justify-center gap-1 rounded-xl border-4 ${FOCUS} ${DISABLED}`;

/** A policy card in the hand (toggle button). */
export const HAND_CARD = `sh-hand-card rounded-lg ${FOCUS} ${DISABLED}`;
