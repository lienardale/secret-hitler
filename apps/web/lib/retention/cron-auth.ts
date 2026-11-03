import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison of the Authorization header with the expected one. */
export function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const given = Buffer.from(header ?? "", "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
