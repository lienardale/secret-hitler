/**
 * The facts behind the content pages, in one place so they never disagree:
 * who publishes the site, who hosts it, the original game's credit line and
 * licence, and when the legal pages last changed.
 *
 * Read by the legal notice (`/mentions-legales`), the privacy policy
 * (`/confidentialite`), the credits page and the site footer.
 */

/**
 * The publisher (French LCEN, art. 6-III). Two shapes:
 * - `named`: a person or organisation named on the legal notice, with the
 *   publication director;
 * - `anonymous`: a private individual publishing non-professionally who keeps
 *   their identity private (LCEN art. 6-III-2). The notice then says so, names
 *   the hosts and says the publisher's identity was given to the host
 *   `identityHost`.
 */
export type Publisher =
  | {
      kind: "named";
      name: string;
      /** Postal address, one line per entry. */
      address: readonly string[];
      /** The publication director (often the publisher). */
      director: string;
      phone?: string;
    }
  | { kind: "anonymous"; identityHost: HostId };

/** The operator's choice (2026-11-02): an anonymous non-professional publisher. */
export const PUBLISHER: Publisher = { kind: "anonymous", identityHost: "vercel" };

export type HostId = "vercel" | "cloudflare" | "neon";

export interface Host {
  id: HostId;
  /** The service's usual name. */
  service: string;
  /** The company that provides it (the legal name on its own legal pages). */
  company: string;
  /** Postal address without the country, one line per entry. */
  address: readonly string[];
  /** ISO 3166 code; the pages show the country's name in the reader's language. */
  country: "US";
  /** As published by the host; null when its legal pages give none. */
  phone: string | null;
  website: string;
}

/**
 * Hosts, checked on each provider's own legal pages on 2026-11-02:
 *
 * - Vercel Inc.: https://vercel.com/legal/privacy-policy (June 1, 2026),
 *   https://vercel.com/legal/terms (October 19, 2026, § 23.3.4) and
 *   https://vercel.com/legal/dpa (March 17, 2026). No phone number is published.
 * - Cloudflare, Inc.: https://www.cloudflare.com/terms/ (Self-Serve Subscription
 *   Agreement, September 12, 2025, § 17.4), https://www.cloudflare.com/website-terms/
 *   and https://www.cloudflare.com/privacypolicy/ (November 4, 2025; the phone
 *   number is in their "Have questions?" block).
 * - Neon: since the 2025 acquisition, Neon's terms (https://neon.com/terms-of-service,
 *   October 14, 2026) are "between Databricks, Inc., the parent company of Neon, LLC"
 *   and the customer; https://neon.com/privacy-policy redirects to
 *   https://www.databricks.com/legal/privacynotice (January 9, 2026), which gives
 *   the address below (the databricks.com footer says "15th Floor" instead of
 *   "Suite 1300"; the legal text is used here). Phone: databricks.com footer.
 *   A database added from the Vercel Marketplace is still contracted with the
 *   vendor (https://vercel.com/legal/integrations-marketplace-service-terms).
 */
export const HOSTS: readonly Host[] = [
  {
    id: "vercel",
    service: "Vercel",
    company: "Vercel Inc.",
    address: ["440 N Barranca Avenue #4133", "Covina, CA 91723"],
    country: "US",
    phone: null,
    website: "https://vercel.com",
  },
  {
    id: "cloudflare",
    service: "Cloudflare",
    company: "Cloudflare, Inc.",
    address: ["101 Townsend St.", "San Francisco, CA 94107"],
    country: "US",
    phone: "+1 (650) 319-8930",
    website: "https://www.cloudflare.com",
  },
  {
    id: "neon",
    service: "Neon",
    company: "Databricks, Inc.",
    address: ["160 Spear Street, Suite 1300", "San Francisco, CA 94105"],
    country: "US",
    phone: "+1 866 330 0121",
    website: "https://neon.com",
  },
];

/** The public source code, once the repository is public (the credits page links it then). */
export const SOURCE_CODE_URL: string | null = null;

/** When the legal notice and the privacy policy last changed (YYYY-MM-DD). */
export const LEGAL_UPDATED = "2026-11-02";

/**
 * The original game's credit line, exactly as the official rules give it. It
 * stays in English in every language: never translate or reword it.
 */
export const GAME_CREDIT =
  "Secret Hitler was created by Mike Boxleiter, Tommy Maranges, and Mac Schubert.";
export const GAME_COPYRIGHT = "© 2016-2021 Goat, Wolf, & Cabbage LLC";

export const LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
export const OFFICIAL_SITE_URL = "https://www.secrethitler.com/";
export const RULES_PDF_URL = "https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf";
export const PRINT_AND_PLAY_URL =
  "https://www.secrethitler.com/assets/Secret_Hitler_Print_and_Play.pdf";

/** "2 novembre 2026" / "November 2, 2026": a calendar date, the same in every time zone. */
export function formatLegalDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}
