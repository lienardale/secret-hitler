import { notFound } from "next/navigation";

/**
 * Any unknown path under a locale: show `app/[locale]/not-found.tsx` inside the
 * locale layout (with `<html lang>`, header and footer) instead of Next's bare
 * default 404.
 */
export default function UnknownPage(): never {
  notFound();
}
