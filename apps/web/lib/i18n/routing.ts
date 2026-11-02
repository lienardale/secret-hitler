/**
 * Locale routing — the single source of truth for locales and URL shapes
 * (same conventions as velo-atelier).
 *
 * - `localePrefix: 'always'`: every URL carries its locale (`/fr/…`, `/en/…`).
 * - `localeDetection: false`: `/` always lands on `/fr`; visitors switch locale themselves.
 * - `pathnames`: keys are the internal (French) paths, i.e. the folder names under
 *   `app/[locale]/`; values are what each locale shows in the address bar.
 *
 * Adding a route: add its key here when its page lands.
 */
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  localePrefix: "always",
  localeDetection: false,
  pathnames: {
    "/": "/",
    "/salle/[code]": { fr: "/salle/[code]", en: "/room/[code]" },
    // Test page (404 unless ENABLE_TEST_PAGES=1): the game table on local fixtures.
    "/dev/table": "/dev/table",
  },
});

export type Locale = (typeof routing.locales)[number];
export type Pathname = keyof typeof routing.pathnames;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value);
}
