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
    "/jouer": { fr: "/jouer", en: "/play" },
    "/connexion": { fr: "/connexion", en: "/sign-in" },
    "/inscription": { fr: "/inscription", en: "/sign-up" },
    "/bienvenue": { fr: "/bienvenue", en: "/welcome" },
    "/verifier-email": { fr: "/verifier-email", en: "/verify-email" },
    "/profil": { fr: "/profil", en: "/profile" },
    "/conduite": { fr: "/conduite", en: "/conduct" },
    // Content pages (M6): the rules, the credits and the two legal pages.
    "/regles": { fr: "/regles", en: "/rules" },
    "/credits": "/credits",
    "/mentions-legales": { fr: "/mentions-legales", en: "/legal-notice" },
    "/confidentialite": { fr: "/confidentialite", en: "/privacy" },
    // Moderators and admins only (MODERATOR / ADMIN role).
    "/admin/signalements": { fr: "/admin/signalements", en: "/admin/reports" },
    "/admin/signalements/[id]": { fr: "/admin/signalements/[id]", en: "/admin/reports/[id]" },
    "/admin/bannis": { fr: "/admin/bannis", en: "/admin/bans" },
    // Test page (404 unless ENABLE_TEST_PAGES=1): the game table on local fixtures.
    "/dev/table": "/dev/table",
  },
});

export type Locale = (typeof routing.locales)[number];
export type Pathname = keyof typeof routing.pathnames;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value);
}
