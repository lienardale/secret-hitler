import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NAMESPACES } from "../../lib/i18n/namespaces";

const MESSAGES = join(import.meta.dirname, "../../messages");

function load(locale: string, namespace: string): unknown {
  return JSON.parse(readFileSync(join(MESSAGES, locale, `${namespace}.json`), "utf8"));
}

/** Every leaf key path of a nested message object, sorted. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe.each(NAMESPACES)("message catalogue %s", (namespace) => {
  const fr = load("fr", namespace);
  const en = load("en", namespace);

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
