/**
 * The site's own origin for links in e-mails: AUTH_URL when set, else the
 * request's host (actions only run same-origin, so the host is ours).
 */
export function siteOrigin(headers: Headers, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUTH_URL?.trim();
  if (configured) return new URL(configured).origin;
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
