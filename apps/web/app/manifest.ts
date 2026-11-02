/**
 * Web app manifest, served at /manifest.webmanifest (one for both languages:
 * the name is the same, `/` lands on the default locale).
 * Colours are the light-theme tokens, like `viewport.themeColor` in the locale layout.
 */
import type { MetadataRoute } from "next";

import { APP_ICONS, PWA_COLORS, appIconUrl } from "@/lib/pwa/icons";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Secret Hitler",
    short_name: "Secret Hitler",
    // The home taglines (messages/*/common.json), French then English.
    description:
      "Le jeu de déduction sociale, en ligne et gratuit. The social deduction game, online and free.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PWA_COLORS.paper,
    theme_color: PWA_COLORS.paper,
    categories: ["games"],
    icons: APP_ICONS.filter((icon) => icon.variant !== "apple").map((icon) => ({
      src: appIconUrl(icon),
      sizes: `${icon.size}x${icon.size}`,
      type: "image/png",
      purpose: icon.variant === "maskable" ? "maskable" : "any",
    })),
  };
}
