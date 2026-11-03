import { describe, expect, it } from "vitest";

import { authorized } from "../../lib/retention/cron-auth";

const SECRET = "ci-dummy-cron-secret-0123456789abcdef";

describe("cron authorization", () => {
  it("accepts only the exact bearer header", () => {
    expect(authorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(authorized(null, SECRET)).toBe(false);
    expect(authorized("", SECRET)).toBe(false);
    expect(authorized(SECRET, SECRET)).toBe(false);
    expect(authorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(authorized(`bearer ${SECRET}`, SECRET)).toBe(false);
  });
});
