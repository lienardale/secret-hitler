/**
 * `?callbackUrl=` sanitising (from velo-atelier). The value is attacker
 * controlled, so anything that is not a plain same-site absolute path is
 * replaced by the default landing page — never echoed back or "fixed up".
 *
 * Refused: absolute URLs, `//host`, `/\host` (browsers turn `\` into `/`),
 * `/%2F%2Fhost` (after one decoding), schemes (`javascript:`), control
 * characters, `/api/*` endpoints and relative paths. The query is kept, the
 * fragment dropped.
 */
import type { Locale } from "@/lib/i18n/routing";

/** Where a signed-in visitor lands without a usable callback: the home page. */
export function defaultCallbackUrl(locale: Locale): string {
  return `/${locale}`;
}

function looksLikePath(value: string): boolean {
  if (!value.startsWith("/")) return false;
  const second = value.charAt(1);
  return second !== "/" && second !== "\\";
}

function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "\u0000";
  }
}

export function safeCallbackUrl(raw: unknown, locale: Locale): string {
  if (typeof raw !== "string") return defaultCallbackUrl(locale);
  const candidate = raw.trim();
  if (candidate.length === 0 || candidate.length > 512) return defaultCallbackUrl(locale);
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return defaultCallbackUrl(locale);
  const normalized = candidate.replace(/\\/g, "/");
  if (!looksLikePath(normalized) || !looksLikePath(decodeOnce(normalized))) {
    return defaultCallbackUrl(locale);
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return defaultCallbackUrl(locale);
  const pathAndQuery = normalized.split("#")[0] ?? "";
  const path = pathAndQuery.split("?")[0] ?? "";
  if (path === "/api" || path.startsWith("/api/")) return defaultCallbackUrl(locale);
  return pathAndQuery;
}
