/**
 * Request proxy (Next 16's middleware): next-intl locale routing.
 * `/` → `/fr`; localized external paths are rewritten to their internal route.
 * Auth.js joins in M4 (see velo-atelier's proxy.ts for the pattern).
 */
import createMiddleware from "next-intl/middleware";

import { routing } from "./lib/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
