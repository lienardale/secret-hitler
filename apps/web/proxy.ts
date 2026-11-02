/**
 * Request proxy (Next 16's middleware):
 * - `/r/CODE` invite links → the room page in the visitor's language
 *   (their NEXT_LOCALE cookie, else French);
 * - `/connexion?error=…` without a locale (Auth.js builds its error and
 *   sign-in URLs itself, unprefixed) → the sign-in page in the visitor's language;
 * - next-intl locale routing for everything else (`/` → `/fr`, localized paths).
 *
 * The proxy never reads or writes the session: pages, actions and route
 * handlers check it themselves (lib/auth/current-user.ts), so the proxy and a
 * page can never disagree about who is signed in.
 */
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeRoomCode } from "@sh/protocol";

import { getPathname } from "./lib/i18n/navigation";
import { isLocale, routing } from "./lib/i18n/routing";

const intl = createMiddleware(routing);
const SHORT_LINK = /^\/r\/([^/]{1,12})\/?$/;
const UNPREFIXED_AUTH = new Set(["/connexion", "/inscription"] as const);

function visitorLocale(request: NextRequest) {
  const cookie = request.cookies.get("NEXT_LOCALE")?.value;
  return isLocale(cookie) ? cookie : routing.defaultLocale;
}

export default function proxy(request: NextRequest) {
  const bare = request.nextUrl.pathname as "/connexion" | "/inscription";
  if (UNPREFIXED_AUTH.has(bare)) {
    const locale = visitorLocale(request);
    const target = new URL(getPathname({ locale, href: bare }), request.url);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 307);
  }
  const short = SHORT_LINK.exec(request.nextUrl.pathname);
  if (short) {
    const code = normalizeRoomCode(decodeURIComponent(short[1] as string));
    const locale = visitorLocale(request);
    const target = code
      ? getPathname({ locale, href: { pathname: "/salle/[code]", params: { code } } })
      : getPathname({ locale, href: "/" });
    return NextResponse.redirect(new URL(target, request.url), 307);
  }
  return intl(request);
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
