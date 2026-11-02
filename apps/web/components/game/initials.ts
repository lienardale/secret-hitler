/**
 * Short initials for every seat, unique within the table, so ten players are
 * easy to tell apart at a glance: "Ada" → "A", "Jean Dupont" → "JD". Pure.
 *
 * - One word: its first letter. Several words: first letter of the first and
 *   of the last word. Upper-case, by grapheme (accents, any script, emoji).
 * - Names whose initials clash all get two letters instead: the first letter
 *   plus another one from the name ("Ada" / "Alice" → "AD" / "AL").
 * - Still taken: the first letter plus a digit ("A2", "A3"…).
 */

let segmenter: Intl.Segmenter | null | undefined;

/** User-perceived characters ("É", "👩‍🚀"), not UTF-16 units. */
function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  if (segmenter) return Array.from(segmenter.segment(text), (part) => part.segment);
  return Array.from(text);
}

/** Upper-case, unless that changes the length ("ß" → "SS" stays "ß"). */
function upper(grapheme: string): string {
  const up = grapheme.toUpperCase();
  return graphemes(up).length === 1 ? up : grapheme;
}

/** Words made of letters, digits and their combining marks. */
function words(name: string): string[][] {
  return name
    .normalize("NFC")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)
    .map(graphemes);
}

interface Candidates {
  primary: string;
  /** Two-letter fallbacks, best first (never the primary). */
  alternates: string[];
  /** First letter, for the digit fallback. */
  first: string;
}

function candidates(name: string): Candidates {
  const parts = words(name);
  if (parts.length === 0) {
    // No letter or digit at all (emoji only): use the visible characters.
    const chars = graphemes(name.trim()).filter((g) => g.trim() !== "");
    const first = chars[0] ?? "?";
    return {
      primary: first,
      alternates: unique(
        chars.slice(1).map((c) => first + c),
        first,
      ),
      first,
    };
  }
  const head = parts[0] as string[];
  const first = upper(head[0] as string);
  const last = parts.length > 1 ? (parts.at(-1) as string[]) : null;
  const primary = last ? first + upper(last[0] as string) : first;

  const middle = parts.slice(1, -1);
  const seconds = last
    ? [
        ...middle.map((word) => word[0] as string),
        ...last.slice(1),
        ...head.slice(1),
        ...middle.flatMap((word) => word.slice(1)),
      ]
    : head.slice(1);
  return {
    primary,
    alternates: unique(
      seconds.map((c) => first + upper(c)),
      primary,
    ),
    first,
  };
}

function unique(list: string[], except: string): string[] {
  return [...new Set(list)].filter((item) => item !== except);
}

/** Initials for each name (index = seat), unique within the list. */
export function assignInitials(names: readonly string[]): string[] {
  const all = names.map(candidates);
  const counts = new Map<string, number>();
  for (const c of all) counts.set(c.primary, (counts.get(c.primary) ?? 0) + 1);
  // Initials nobody else wants are kept as they are, and reserved first.
  const taken = new Set(all.filter((c) => counts.get(c.primary) === 1).map((c) => c.primary));

  return all.map((c) => {
    if (counts.get(c.primary) === 1) return c.primary;
    const pick = c.alternates.find((candidate) => !taken.has(candidate));
    if (pick !== undefined) {
      taken.add(pick);
      return pick;
    }
    for (let n = 2; ; n++) {
      const numbered = `${c.first}${n}`;
      if (!taken.has(numbered)) {
        taken.add(numbered);
        return numbered;
      }
    }
  });
}
