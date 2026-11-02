/**
 * Same-origin check for server actions and POST route handlers (adapted from
 * velo-atelier). Next already refuses a Server Action whose Origin does not
 * match; this is the second lock, and the only one on route handlers.
 *
 * Compares Origin's host with `x-forwarded-host ?? host` (what a proxy such
 * as Vercel sets). A request with no Origin is refused: browsers always send
 * it on POST.
 */
export function requestHost(headers: Headers): string | null {
  return headers.get("x-forwarded-host") ?? headers.get("host");
}

export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = requestHost(headers);
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
