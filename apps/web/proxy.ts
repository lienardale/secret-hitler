/**
 * Request proxy (Next 16's middleware):
 * - `/r/CODE` invite links → the room page in the visitor's language
 *   (their NEXT_LOCALE cookie, else French);
 * - next-intl locale routing for everything else (`/` → `/fr`, localized paths).
 * Auth.js joins in M4.
 */
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeRoomCode } from "@sh/protocol";

import { getPathname } from "./lib/i18n/navigation";
import { isLocale, routing } from "./lib/i18n/routing";

const intl = createMiddleware(routing);
const SHORT_LINK = /^\/r\/([^/]{1,12})\/?$/;

export default function proxy(request: NextRequest) {
  const short = SHORT_LINK.exec(request.nextUrl.pathname);
  if (short) {
    const code = normalizeRoomCode(decodeURIComponent(short[1] as string));
    const cookie = request.cookies.get("NEXT_LOCALE")?.value;
    const locale = isLocale(cookie) ? cookie : routing.defaultLocale;
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
