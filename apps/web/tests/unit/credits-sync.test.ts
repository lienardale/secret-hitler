/**
 * CREDITS.md and the credits page (messages/{fr,en}/credits.json) list the
 * same changes from the board game, in the same order: the licence asks us to
 * say what we changed, and both places must stay complete.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GAME_COPYRIGHT, GAME_CREDIT, LICENSE_URL } from "../../lib/legal";
import enCredits from "../../messages/en/credits.json";
import frCredits from "../../messages/fr/credits.json";

const CREDITS_MD = readFileSync(join(import.meta.dirname, "../../../../CREDITS.md"), "utf8");

/** The top-level bullets under a `## heading`, each joined into one line. */
function bulletsUnder(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`CREDITS.md has no "## ${heading}" section`);
  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("- ")) bullets.push(line.slice(2));
    else if (bullets.length > 0 && line.startsWith("  ") && line.trim() !== "") {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    }
  }
  return bullets;
}

const changes = bulletsUnder(CREDITS_MD, "What we changed");

describe("What we changed", () => {
  it("CREDITS.md lists some changes", () => {
    expect(changes.length).toBeGreaterThan(0);
  });

  it.each([
    ["en", enCredits],
    ["fr", frCredits],
  ] as const)("the %s credits page has as many items as CREDITS.md", (_locale, messages) => {
    expect(Object.keys(messages.changed.items)).toHaveLength(changes.length);
  });

  it("the English items have the same titles, in the same order", () => {
    const titles = changes.map((bullet) => /^\*\*(.+?)\*\*/.exec(bullet)?.[1]);
    expect(titles).toEqual(Object.values(enCredits.changed.items).map((item) => item.title));
  });

  it("French and English list the same items", () => {
    expect(Object.keys(frCredits.changed.items)).toEqual(Object.keys(enCredits.changed.items));
  });
});

describe("the original game's credit", () => {
  it("CREDITS.md carries the exact credit line, copyright and licence the pages show", () => {
    expect(CREDITS_MD).toContain(`**${GAME_CREDIT}**`);
    expect(CREDITS_MD).toContain(GAME_COPYRIGHT);
    expect(CREDITS_MD).toContain(LICENSE_URL);
  });

  it("is the official line, word for word", () => {
    expect(GAME_CREDIT).toBe(
      "Secret Hitler was created by Mike Boxleiter, Tommy Maranges, and Mac Schubert.",
    );
  });
});
