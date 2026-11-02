import { describe, expect, it } from "vitest";

import en from "../../messages/en/common.json";
import fr from "../../messages/fr/common.json";

/** Every leaf key path of a nested message object, sorted. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe("message catalogues", () => {
  it("French and English define the same keys", () => {
    expect(keyPaths(en)).toEqual(keyPaths(fr));
  });

  it("no message is empty", () => {
    for (const catalogue of [fr, en]) {
      for (const path of keyPaths(catalogue)) {
        const leaf = path
          .split(".")
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], catalogue);
        expect(typeof leaf === "string" && leaf.trim().length > 0, path).toBe(true);
      }
    }
  });
});
