/**
 * Party and role emblems: small ORIGINAL drawings (not the official artwork),
 * one component each so real art can replace any of them later.
 *
 * They draw with `currentColor` and are decorative by default: the text next
 * to them always names the party or role (meaning never rests on the picture
 * or its colour alone). Pass `title` to give one an accessible name.
 */
import type { SVGProps } from "react";

export interface ArtProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Accessible name; omit for a decorative emblem (aria-hidden). */
  title?: string;
}

function a11y(title: string | undefined) {
  return title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };
}

/** Liberal: a stylised dove in flight. */
export function LiberalEmblem({ title, ...props }: ArtProps) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" focusable="false" {...a11y(title)} {...props}>
      <path
        fillRule="evenodd"
        d="M2.5 17.5 9.8 16 13.6 5.2 18.2 14.4l6.3-1.6 4.9 2.1-3.9 1.8-2.7 4.6-8.6 2.4-5.8 3.6 1.9-4.8Zm21.3-2.9a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z"
      />
      <path d="M14.6 8.6 20.4 3l-1.2 6.7-2.6 2.9Z" opacity=".75" />
    </svg>
  );
}

/** Fascist: a skull. */
export function FascistEmblem({ title, ...props }: ArtProps) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" focusable="false" {...a11y(title)} {...props}>
      <path
        fillRule="evenodd"
        d="M16 3C9.4 3 5 7.6 5 13.5c0 3.6 1.7 6.1 4 7.6V25a2 2 0 0 0 2 2h1.5v-2.5h2V27h3v-2.5h2V27H21a2 2 0 0 0 2-2v-3.9c2.3-1.5 4-4 4-7.6C27 7.6 22.6 3 16 3Zm-5 9.3a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Zm10 0a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8ZM16 18.2l1.7 3.1h-3.4Z"
      />
    </svg>
  );
}

/** Hitler: a crowned skull (the fascists' secret leader). */
export function HitlerEmblem({ title, ...props }: ArtProps) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" focusable="false" {...a11y(title)} {...props}>
      <path d="M8 9.5 7 3.5l4.5 3L16 2l4.5 4.5 4.5-3-1 6Z" />
      <path
        fillRule="evenodd"
        d="M16 10.5c-5.3 0-8.8 3.5-8.8 8 0 2.8 1.3 4.7 3.1 5.9v2.4c0 .9.7 1.6 1.6 1.6h1.2v-2h1.6v2h2.6v-2h1.6v2h1.2c.9 0 1.6-.7 1.6-1.6v-2.4c1.8-1.2 3.1-3.1 3.1-5.9 0-4.5-3.5-8-8.8-8Zm-4 7.2a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Zm8 0a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6ZM16 22l1.3 2.4h-2.6Z"
      />
    </svg>
  );
}
