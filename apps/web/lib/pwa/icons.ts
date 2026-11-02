/**
 * The app's icon: two policy cards fanned like a hand, a liberal one (dove) and
 * a fascist one (skull). An ORIGINAL mark drawn here from the emblems in
 * components/game/art/emblems.tsx (same path data), not the official artwork.
 *
 * One SVG source for every variant:
 * - `any`: an ink tile with rounded corners (favicon `app/icon.svg`, manifest 192/512);
 * - `maskable`: full-bleed ink, the mark inside the central 80 % circle (Android masks);
 * - `apple`: full-bleed ink square (iOS rounds the corners itself, and turns
 *   transparency into black).
 *
 * The PNGs are drawn at build time by `app/app-icons/[file]/route.tsx` with
 * `ImageResponse` (no text, so no font, no network). Their URLs carry a file
 * extension so the locale proxy (proxy.ts) never redirects them to `/fr/…`.
 */

/** Token colours (styles/globals.css, light theme). */
export const PWA_COLORS = {
  paper: "#f3e3c3",
  ink: "#2a221b",
  liberal: "#2d6489",
  fascist: "#a8382a",
} as const;

export type IconVariant = "any" | "maskable" | "apple";

export interface AppIcon {
  /** Last URL segment under /app-icons/ (the route's `[file]` param). */
  file: string;
  size: number;
  variant: IconVariant;
}

export const APP_ICON_BASE = "/app-icons";

/** Every PNG the site serves. The manifest and the layout read their URLs from here. */
export const APP_ICONS = [
  { file: "icon-192.png", size: 192, variant: "any" },
  { file: "icon-512.png", size: 512, variant: "any" },
  { file: "maskable-512.png", size: 512, variant: "maskable" },
  { file: "apple-touch-icon-180.png", size: 180, variant: "apple" },
] as const satisfies readonly AppIcon[];

/** Linked as a favicon too, for browsers without SVG favicons (Safari before 26). */
export const PNG_FAVICON = APP_ICONS[0];
export const APPLE_TOUCH_ICON = APP_ICONS[3];

export function appIconUrl(icon: Pick<AppIcon, "file">): string {
  return `${APP_ICON_BASE}/${icon.file}`;
}

export function findAppIcon(file: string): AppIcon | undefined {
  return APP_ICONS.find((icon) => icon.file === file);
}

/** Same drawings as LiberalEmblem / FascistEmblem (viewBox 0 0 32 32). */
const DOVE = [
  "M2.5 17.5 9.8 16 13.6 5.2 18.2 14.4l6.3-1.6 4.9 2.1-3.9 1.8-2.7 4.6-8.6 2.4-5.8 3.6 1.9-4.8Zm21.3-2.9a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z",
  "M14.6 8.6 20.4 3l-1.2 6.7-2.6 2.9Z",
] as const;
const SKULL =
  "M16 3C9.4 3 5 7.6 5 13.5c0 3.6 1.7 6.1 4 7.6V25a2 2 0 0 0 2 2h1.5v-2.5h2V27h3v-2.5h2V27H21a2 2 0 0 0 2-2v-3.9c2.3-1.5 4-4 4-7.6C27 7.6 22.6 3 16 3Zm-5 9.3a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Zm10 0a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8ZM16 18.2l1.7 3.1h-3.4Z";

/** Geometry of the mark, in a 64-unit canvas centred on (32, 32). */
const CANVAS = 64;
const CARD = { width: 26, height: 38, radius: 3.5, stroke: 2.5, emblem: 18 } as const;
const CARDS = [
  { cx: 21.5, cy: 32, angle: -10, fill: PWA_COLORS.liberal, art: "dove" },
  { cx: 42.5, cy: 32, angle: 10, fill: PWA_COLORS.fascist, art: "skull" },
] as const;

/** How much of the canvas the mark gets, per variant. */
const MARK_SCALE: Record<IconVariant, number> = {
  any: 0.8,
  // Safe zone: a circle of radius 0.4 × 64 = 25.6 units (see markExtent).
  maskable: 0.7,
  apple: 0.8,
};

function emblem(art: "dove" | "skull"): string {
  if (art === "dove") {
    return `<path fill-rule="evenodd" d="${DOVE[0]}"/><path d="${DOVE[1]}" opacity=".75"/>`;
  }
  return `<path fill-rule="evenodd" d="${SKULL}"/>`;
}

/** A policy card centred on (0, 0), emblem in the middle. */
function card(fill: string, art: "dove" | "skull"): string {
  const { width, height, radius, stroke, emblem: size } = CARD;
  return (
    `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" ` +
    `rx="${radius}" fill="${fill}" stroke="${PWA_COLORS.paper}" stroke-width="${stroke}"/>` +
    `<g transform="translate(${-size / 2} ${-size / 2}) scale(${size / 32})" ` +
    `fill="${PWA_COLORS.paper}">${emblem(art)}</g>`
  );
}

/** The complete icon as an SVG document (64-unit viewBox, scales to any size). */
export function iconSvg(variant: IconVariant): string {
  const background =
    variant === "any"
      ? `<rect width="${CANVAS}" height="${CANVAS}" rx="14" fill="${PWA_COLORS.ink}"/>`
      : `<rect width="${CANVAS}" height="${CANVAS}" fill="${PWA_COLORS.ink}"/>`;
  const scale = MARK_SCALE[variant];
  const offset = round((CANVAS / 2) * (1 - scale));
  const cards = CARDS.map(
    (c) =>
      `<g transform="translate(${c.cx} ${c.cy}) rotate(${c.angle})">${card(c.fill, c.art)}</g>`,
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">` +
    background +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${cards}</g>` +
    `</svg>\n`
  );
}

/** The icon as a data: URI, for an <img> inside ImageResponse. */
export function iconDataUri(variant: IconVariant): string {
  return `data:image/svg+xml;base64,${btoa(iconSvg(variant))}`;
}

/**
 * Distance from the canvas centre to the farthest point of the mark (outer edge
 * of a card's stroke, corners taken square), in canvas units. A maskable icon
 * must keep it under 0.4 × 64 = 25.6.
 */
export function markExtent(variant: IconVariant): number {
  const halfW = CARD.width / 2 + CARD.stroke / 2;
  const halfH = CARD.height / 2 + CARD.stroke / 2;
  let farthest = 0;
  for (const c of CARDS) {
    const rad = (c.angle * Math.PI) / 180;
    for (const [x, y] of [
      [-halfW, -halfH],
      [halfW, -halfH],
      [-halfW, halfH],
      [halfW, halfH],
    ] as const) {
      const px = c.cx + x * Math.cos(rad) - y * Math.sin(rad);
      const py = c.cy + x * Math.sin(rad) + y * Math.cos(rad);
      farthest = Math.max(farthest, Math.hypot(px - CANVAS / 2, py - CANVAS / 2));
    }
  }
  return farthest * MARK_SCALE[variant];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
