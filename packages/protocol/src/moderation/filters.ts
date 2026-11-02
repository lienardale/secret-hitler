/**
 * Word filters (moderation, M5). Pure functions with no zod, so the website,
 * the rooms Worker and browser code can all import them.
 *
 * - `containsSlur(text)`: chat. Narrow on purpose: slurs, Nazi slogans and
 *   incitement against a group (FR + EN), never ordinary swearing, and never
 *   the game's own vocabulary ("Hitler", "fasciste", "nazi", "tuer"…), which
 *   players type all the time.
 * - `isOffensiveName(name)`: display names. Broader: every slur, obscenity's
 *   English profanity dataset, a French profanity list and Nazi references.
 *
 * Both use one `obscenity` matcher each (FR and EN patterns together), with
 * its recommended transformers: confusable Unicode letters, leetspeak
 * ("n1gg3r"), ASCII case and repeated letters ("niiiigger"). The matchers are
 * built on first use and cached, so importing this module costs nothing until
 * a filter runs. The lists are in `words.ts`.
 *
 * Text is checked in a few spellings ("variants"), any match counts:
 * 1. accents folded, punctuation turned into spaces (leetspeak symbols kept);
 * 2. the same with "1" read as "l" (obscenity reads it as "i": "Hit1er");
 * 3. letters and digits only, leetspeak symbols turned into spaces ("fag!");
 * 4. single letters split by spaces or dots joined ("s a l o p e", "p.u.t.e");
 * 5. names only: camelCase and letters/digits split ("GrosseBite69").
 * Folding accents first matters: obscenity's word boundaries are ASCII-only,
 * so "députe" would otherwise contain a word starting with "pute".
 */
import {
  DataSet,
  RegExpMatcher,
  collapseDuplicatesTransformer,
  englishDataset,
  parseRawPattern,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  toAsciiLowerCaseTransformer,
} from "obscenity";

import {
  EN_DATASET_NAME_EXCLUDED,
  EN_DATASET_SLURS,
  EN_NAME_PATTERNS,
  FR_NAME_PATTERNS,
  HATE_NAME_PATTERNS,
  INCITEMENT_SOURCES,
  NAME_WHITELIST,
  SLUR_PATTERNS,
  SLUR_WHITELIST,
} from "./words";

/** True when `text` contains a slur the chat refuses. */
export function containsSlur(text: string): boolean {
  const filters = getFilters();
  const leet = leetVariant(text);
  const plain = plainVariant(text);
  return (
    matchesAny(filters.chat, [leet, oneAsL(leet), plain, joinSingleLetters(plain)]) ||
    filters.incitement.some((re) => re.test(plain))
  );
}

/** True when a display name is obscene or offensive. */
export function isOffensiveName(name: string): boolean {
  const filters = getFilters();
  const spaced = name.replace(/_/g, " ");
  const leet = leetVariant(spaced);
  const plain = plainVariant(spaced);
  const split = plainVariant(splitWords(spaced));
  if (HATE_CODES.some((re) => re.test(plain))) return true;
  return (
    matchesAny(filters.name, [leet, oneAsL(leet), plain, joinSingleLetters(plain), split]) ||
    filters.incitement.some((re) => re.test(plain) || re.test(split))
  );
}

/** Number codes and initials, matched before leetspeak turns digits into letters. */
const HATE_CODES = [/(?<!\d)14 ?88(?!\d)/, /\bk ?k ?k\b/];

// ---------------------------------------------------------------------------
// Matchers, built once on first use

interface Filters {
  chat: RegExpMatcher;
  name: RegExpMatcher;
  incitement: RegExp[];
}

let cached: Filters | undefined;

function getFilters(): Filters {
  cached ??= buildFilters();
  return cached;
}

/** Letters obscenity keeps up to twice ("nigger", "faggot", "boobs"); others once. */
const DUPLICATE_THRESHOLDS: ReadonlyMap<string, number> = new Map([
  ["b", 2],
  ["e", 2],
  ["o", 2],
  ["l", 2],
  ["s", 2],
  ["g", 2],
]);

type Metadata = { originalWord: string };

function buildFilters(): Filters {
  const slurs = new DataSet<Metadata>()
    .addAll(englishDataset)
    .removePhrasesIf((phrase) => !EN_DATASET_SLURS.includes(phrase.metadata?.originalWord ?? ""));
  addPatterns(slurs, SLUR_PATTERNS);

  const names = new DataSet<Metadata>()
    .addAll(englishDataset)
    .removePhrasesIf((phrase) =>
      EN_DATASET_NAME_EXCLUDED.includes(phrase.metadata?.originalWord ?? ""),
    );
  addPatterns(names, [
    ...SLUR_PATTERNS,
    ...EN_NAME_PATTERNS,
    ...FR_NAME_PATTERNS,
    ...HATE_NAME_PATTERNS,
  ]);

  return {
    chat: matcherFor(slurs, SLUR_WHITELIST),
    name: matcherFor(names, [...SLUR_WHITELIST, ...NAME_WHITELIST]),
    incitement: INCITEMENT_SOURCES.map((source) => new RegExp(source)),
  };
}

function addPatterns(dataset: DataSet<Metadata>, patterns: readonly string[]): void {
  for (const pattern of new Set(patterns.map(collapseRepeats))) {
    dataset.addPhrase((phrase) =>
      phrase.setMetadata({ originalWord: pattern }).addPattern(parseRawPattern(pattern)),
    );
  }
}

function matcherFor(dataset: DataSet<Metadata>, whitelist: readonly string[]): RegExpMatcher {
  const built = dataset.build();
  return new RegExpMatcher({
    blacklistedTerms: built.blacklistedTerms,
    whitelistedTerms: [...(built.whitelistedTerms ?? []), ...whitelist],
    blacklistMatcherTransformers: [
      resolveConfusablesTransformer(),
      resolveLeetSpeakTransformer(),
      toAsciiLowerCaseTransformer(),
      collapseDuplicatesTransformer({
        defaultThreshold: 1,
        customThresholds: new Map(DUPLICATE_THRESHOLDS),
      }),
    ],
    whitelistMatcherTransformers: [
      toAsciiLowerCaseTransformer(),
      collapseDuplicatesTransformer({
        defaultThreshold: Number.POSITIVE_INFINITY,
        customThresholds: new Map([[" ", 1]]),
      }),
    ],
  });
}

/**
 * Collapses repeated letters in a pattern exactly as the matcher collapses
 * them in the text, so lists can spell words normally ("connard").
 */
function collapseRepeats(pattern: string): string {
  let out = "";
  let last = "";
  let run = 0;
  for (const char of pattern) {
    if (char === last && /[a-z ]/.test(char)) {
      run += 1;
      if (run < (DUPLICATE_THRESHOLDS.get(char) ?? 1)) out += char;
    } else {
      last = char;
      run = 0;
      out += char;
    }
  }
  return out;
}

function matchesAny(matcher: RegExpMatcher, variants: string[]): boolean {
  return [...new Set(variants)].some((variant) => variant !== "" && matcher.hasMatch(variant));
}

// ---------------------------------------------------------------------------
// Spellings of the text

/** Symbols obscenity reads as letters ("@" → a, "$" → s, "!" and "|" → i…). */
const LEET_SYMBOLS = new Set(["@", "$", "!", "|", "(", "/"]);

/** Lower case, accents and ligatures folded ("Pédé" → "pede", "Œil" → "oeil"). */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .replace(/[đð]/g, "d")
    .replace(/ł/g, "l")
    .replace(/ı/g, "i");
}

/** Variant 1: punctuation and spaces → one space; leetspeak symbols and emoji kept. */
function leetVariant(text: string): string {
  return fold(text)
    .replace(/[\p{P}\p{Z}\s]/gu, (char) => (LEET_SYMBOLS.has(char) ? char : " "))
    .replace(/ +/g, " ")
    .trim();
}

/** Variant 2: "1" read as "l" ("sa1ope", "Hit1er"). */
function oneAsL(text: string): string {
  return text.replace(/1/g, "l");
}

/** Variant 3: only letters and digits, separated by single spaces. */
function plainVariant(text: string): string {
  return fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Variant 4: runs of 3+ single-letter words joined ("n i g g e r" → "nigger"). */
function joinSingleLetters(plain: string): string {
  const words = plain.split(" ");
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const word of words) {
    if ([...word].length === 1) run.push(word);
    else {
      flush();
      out.push(word);
    }
  }
  flush();
  return out.join(" ");
}

/** Variant 5 (names): camelCase and letter/digit runs split ("GrosseBite69" → "Grosse Bite 69"). */
function splitWords(name: string): string {
  return name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2");
}
