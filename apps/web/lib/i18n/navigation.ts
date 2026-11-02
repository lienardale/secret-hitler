/**
 * Locale-aware navigation. Always import `Link`, `redirect`, `usePathname`,
 * `useRouter` and `getPathname` from here, never from `next/link` or `next/navigation`.
 */
import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
