/**
 * The caller's address as a rate-limit bucket. Header order is the order of
 * decreasing trust: Vercel's own header (stripped from inbound requests), then
 * `x-real-ip`, then the first `x-forwarded-for` entry. IPv6 is reduced to its
 * /64 (one host can rotate through a whole /64). `local` when no proxy header
 * is present (next dev, tests).
 */
export const LOCAL_CLIENT = "local";

function bucket(raw: string): string {
  let value = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1] as string;
  else if ((value.match(/:/g) ?? []).length === 1) value = value.replace(/:\d+$/, "");
  value = value.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
  if (!value.includes(":")) return value;
  // IPv6: keep the first four groups (expanding a leading `::` is not needed for a bucket key).
  const [head = ""] = value.toLowerCase().split("::");
  const groups = head.split(":").filter(Boolean);
  return `${groups.slice(0, 4).join(":")}::/64`;
}

export function clientIp(headers: Headers): string {
  const candidate =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0];
  return candidate && candidate.trim() !== "" ? bucket(candidate) : LOCAL_CLIENT;
}
