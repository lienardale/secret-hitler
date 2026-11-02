import type * as Obscenity from "obscenity";
import { describe, expect, it, vi } from "vitest";

// Counts the matchers obscenity builds, without changing what they do.
const built = vi.hoisted(() => ({ count: 0 }));
vi.mock("obscenity", async (importOriginal) => {
  const original = await importOriginal<typeof Obscenity>();
  class CountingMatcher extends original.RegExpMatcher {
    constructor(...args: ConstructorParameters<typeof original.RegExpMatcher>) {
      super(...args);
      built.count += 1;
    }
  }
  return { ...original, RegExpMatcher: CountingMatcher };
});

describe("word filters", () => {
  it("build their matchers on first use only, then reuse them", async () => {
    const protocol = await import("../src");
    // Importing the package (what browser code does) builds nothing.
    expect(protocol.nameKey("Zoé")).toBe("zoe");
    expect(built.count).toBe(0);

    expect(protocol.containsSlur("bonjour")).toBe(false);
    const afterFirstUse = built.count;
    expect(afterFirstUse).toBeGreaterThan(0);

    protocol.containsSlur("encore");
    protocol.isOffensiveName("Ada");
    protocol.checkDisplayName("Zoé");
    expect(built.count).toBe(afterFirstUse);
  });
});
