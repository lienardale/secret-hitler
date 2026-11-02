import { describe, expect, it } from "vitest";

import { FAKE_NAMES } from "@/lib/game-fixtures";

import { assignInitials } from "./initials";

function graphemeCount(text: string): number {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text))
    .length;
}

describe("assignInitials", () => {
  it("uses one letter for one word and first + last word otherwise", () => {
    expect(assignInitials(["Ada", "Jean Dupont", "Marie-Claire", "Anne Sophie Martin"])).toEqual([
      "A",
      "JD",
      "MC",
      "AM",
    ]);
  });

  it("gives the sandbox's ten names ten single letters", () => {
    expect(assignInitials([...FAKE_NAMES])).toEqual("ABCDEFGHIJ".split(""));
  });

  it("gives every clashing name two letters, never one", () => {
    expect(assignInitials(["Ada", "Alice", "Basile"])).toEqual(["AD", "AL", "B"]);
    expect(assignInitials(["Jean Dupont", "Julie Durand"])).toEqual(["JU", "JR"]);
  });

  it("keeps a unique initial even when another player's fallback wants it", () => {
    // "Al Lewis" is the only "AL": Alice must take something else.
    expect(assignInitials(["Ada", "Alice", "Al Lewis"])).toEqual(["AD", "AI", "AL"]);
  });

  it("falls back to a digit when no letter is left", () => {
    expect(assignInitials(["Al", "Al", "Al"])).toEqual(["AL", "A2", "A3"]);
    expect(assignInitials(["A", "A"])).toEqual(["A2", "A3"]);
  });

  it("handles accents, other scripts and upper-cases them", () => {
    expect(assignInitials(["élodie", "Émile", "Zoë", "李小龙", "ørjan"])).toEqual([
      "ÉL",
      "ÉM",
      "Z",
      "李",
      "Ø",
    ]);
    // A decomposed accent (e + combining acute) counts as one letter.
    expect(assignInitials(["étienne"])).toEqual(["É"]);
  });

  it("handles emoji, one-letter names and moderator renames", () => {
    expect(assignInitials(["🦊", "🦊 Renard", "👩‍🚀"])).toEqual(["🦊", "R", "👩‍🚀"]);
    expect(assignInitials(["X", "Y"])).toEqual(["X", "Y"]);
    expect(assignInitials(["Player 12345", "Player 13579", "Player 67890"])).toEqual([
      "P2",
      "P3",
      "P6",
    ]);
  });

  it("is always unique and short for ten similar names", () => {
    const tables = [
      ["Anna", "Anne", "Annie", "Ann", "Anaïs", "Antoine", "André", "Alex", "Alexis", "Alexandre"],
      Array.from({ length: 10 }, () => "Player 11111"),
      Array.from({ length: 10 }, (_, i) => `Joueur ${1000 + i}`),
      Array.from({ length: 10 }, () => "Jo"),
    ];
    for (const names of tables) {
      const initials = assignInitials(names);
      expect(new Set(initials).size).toBe(names.length);
      for (const initial of initials) {
        expect(graphemeCount(initial)).toBeGreaterThanOrEqual(1);
        expect(graphemeCount(initial)).toBeLessThanOrEqual(3);
        expect(initial).toBe(initial.toUpperCase());
      }
    }
  });

  it("is stable for the same names", () => {
    const names = ["Ada", "Alice", "Basile", "Bob"];
    expect(assignInitials(names)).toEqual(assignInitials([...names]));
  });
});
