/**
 * Date formats of the profile page. The time zone is explicit: the server
 * renders these (Vercel runs in UTC) and the players are mostly in France, so
 * every date reads in Paris time, on the server and in the browser alike.
 */
export const PROFILE_TIME_ZONE = "Europe/Paris";

/** "2 novembre 2026, 11:20" / "November 2, 2026, 11:20 AM". */
export const DATE_TIME = {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PROFILE_TIME_ZONE,
} as const;

/** "2 novembre 2026". */
export const DATE_ONLY = {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: PROFILE_TIME_ZONE,
} as const;
