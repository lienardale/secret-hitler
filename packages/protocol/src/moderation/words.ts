/**
 * Word lists behind the moderation filters (`filters.ts`) and the reserved
 * display names (`names.ts`). Data only: no imports, and no matcher or
 * regular expression is compiled here.
 *
 * Patterns use obscenity's syntax (https://github.com/jo3-l/obscenity):
 * `|` at the start or end = word boundary, `[x]` = optional text, `?` = any
 * one character. Write them in plain lower case without accents, as the word
 * is spelled: `filters.ts` folds accents out of the text first, and collapses
 * repeated letters in both the text and the patterns the same way (so
 * "connard" also matches "conard" and "connnnard").
 *
 * The game's own vocabulary is never listed for chat: Hitler, nazi, fasciste,
 * facho, fascist, libéral, chancelier, président, exécuter, tuer, kill, shoot.
 * Ordinary swearing (merde, putain, con, connard, fuck, shit…) is allowed in
 * chat and refused only in display names.
 */

/**
 * Entries of obscenity's English dataset (by `originalWord`) that are slurs.
 * Left out on purpose: `abo` (French "abo", short for "abonnement"), `retard`
 * (French "en retard": we list "retarded" instead), and `fag` / `kike`, which
 * are replaced below by patterns with word boundaries (`|fag` matched the
 * French "fagot", `kike` the Yoruba name "Kikelomo").
 */
export const EN_DATASET_SLURS: readonly string[] = [
  "abeed",
  "africoon",
  "arabush",
  "boonga",
  "chingchong",
  "chink",
  "dyke",
  "negro",
  "nigger",
  "spastic",
  "tranny",
];

/** Slurs (FR + EN) refused in chat and in names, beyond `EN_DATASET_SLURS`. */
export const SLUR_PATTERNS: readonly string[] = [
  // English: homophobic and transphobic
  "|fag|",
  "|fags|",
  "|fagg?t",
  "|trannie[s]|",
  "|shemale",
  // English: racist, antisemitic
  "|kike[s]|",
  "|coon[s]|",
  "|spic[s]|",
  "|gook[s]|",
  "|wetback",
  "|raghead",
  "|towelhead",
  "|beaner[s]|",
  "|jigaboo",
  "porch monkey",
  "|zipperhead",
  "|paki[s]|",
  "|yid[s]|",
  "ching chong",
  // English: ableist
  "|retarded|",
  "|mongoloid",
  // French: racist, antisemitic
  "|negre[s]|",
  "|negresse[s]|",
  "|bougnoul[e][s]|",
  "|bicot[s]|",
  "|crouille[s]|",
  "|youpin[e][s]|",
  "|youtre[s]|",
  "|chinetoque[s]|",
  "|chinetok[s]|",
  "|chintok[s]|",
  "|niakoue[s]|",
  // French: homophobic and transphobic
  "|pede[s]|",
  "|tapette[s]|",
  "|tarlouze[s]|",
  "|tarlouse[s]|",
  "|tafiole[s]|",
  "|fiotte[s]|",
  "|tantouze[s]|",
  "|gouine[s]|",
  "|travelo[s]|",
  // French: ableist
  "|mongolien[e][s]|",
  "|triso[s]|",
  // Nazi salutes and slogans (the word "Hitler" alone stays allowed)
  "|sieg heil",
  "|siegheil",
  "|heil hitler",
  "|heilhitler",
  "|juden raus",
  "|white power",
  "|whitepower",
];

/** Whitelisted terms: text that contains a slur pattern but is not one. */
export const SLUR_WHITELIST: readonly string[] = [
  "negroni",
  "negro spiritual",
  "white power ranger",
];

/*
 * Incitement against a group, matched with plain regular expressions on the
 * folded text (accents removed, punctuation turned into spaces). Each needs a
 * verb AND a group noun, so "tuer les fascistes" or "kill the president"
 * never match.
 */

/** French group nouns, singular (plural = + "s"). */
const FR_GROUPS = [
  "juif",
  "juive",
  "feuj",
  "arabe",
  "rebeu",
  "beur",
  "noir",
  "noire",
  "renoi",
  "black",
  "musulman",
  "musulmane",
  "negre",
  "negro",
  "bougnoule",
  "bicot",
  "youpin",
  "pede",
  "gay",
  "homo",
  "gouine",
  "lesbienne",
  "trans",
  "travelo",
  "rom",
  "gitan",
  "gitane",
  "tzigane",
  "chinois",
  "chinoise",
  "chinetoque",
  "asiatique",
  "migrant",
  "immigre",
  "immigree",
  "refugie",
  "refugiee",
  "blanc",
  "blanche",
  "handicape",
  "handicapee",
  "mongolien",
  "triso",
];

/** English group nouns, plural. */
const EN_GROUPS = [
  "jews",
  "kikes",
  "blacks",
  "niggers",
  "negroes",
  "muslims",
  "moslems",
  "arabs",
  "gays",
  "fags",
  "faggots",
  "homos",
  "lesbians",
  "dykes",
  "trans",
  "trannies",
  "gypsies",
  "roma",
  "whites",
  "asians",
  "chinks",
  "mexicans",
  "immigrants",
  "migrants",
  "refugees",
];

const FR_GROUP = `(?:${FR_GROUPS.join("|")})s?`;
const EN_GROUP = `(?:${EN_GROUPS.join("|")})`;
const FR_VERBS = ["gaz", "tu", "brul", "extermin", "massacr", "egorg", "pend", "lynch", "fusill"]
  .map((stem) => `${stem}(?:er|ez|ons)`)
  .join("|");
const EN_VERBS = "gas|kill|burn|hang|lynch|shoot|exterminate|slaughter|nuke";

/** Sources of the incitement expressions (compiled lazily by `filters.ts`). */
export const INCITEMENT_SOURCES: readonly string[] = [
  // "mort aux juifs", "à mort les arabes", "il faut gazer tous les juifs"
  `\\b(?:mort aux|a mort les|(?:${FR_VERBS})(?: tous)? les) ${FR_GROUP}\\b`,
  // "sale juif", "sales arabes"
  `\\bsales? ${FR_GROUP}\\b`,
  // "les juifs au four"
  `\\b${FR_GROUP} (?:au|aux|dans les|dans le) fours?\\b`,
  // "gas the jews", "kill all the gays", "death to muslims"
  `\\b(?:(?:${EN_VERBS})(?: all)?(?: of)?(?: the)?|death to(?: all)?(?: the)?) ${EN_GROUP}\\b`,
  // "jews to the ovens"
  `\\b${EN_GROUP} (?:to|in|into) the (?:ovens?|gas chambers?)\\b`,
  // "dirty jew"
  "\\bdirty (?:jew|jews|jewess|arab|arabs|muslim|muslims|gypsy|gypsies)\\b",
];

/*
 * Display names only (on top of every slur above).
 */

/**
 * Entries of obscenity's English dataset left out of the name filter, or
 * replaced by the narrower patterns of `EN_NAME_PATTERNS`:
 * - `abo`, `retard`: French words (see above);
 * - `fag`, `kike`: replaced by the slur patterns above;
 * - `dick`: "Dick" is a first name (Dick Tracy, Moby Dick, Dickson): only the
 *   obviously sexual compounds are refused;
 * - `fuck`: its `|fu|` pattern refused the surname "Fu" and `|fuk` refused
 *   "Fukuda", "Fukuyama";
 * - `rape`: its `|rape` matched "rapetisser"-like words;
 * - `semen`: its `|semen` refused "Semenov", "Semenya".
 */
export const EN_DATASET_NAME_EXCLUDED: readonly string[] = [
  "abo",
  "retard",
  "fag",
  "kike",
  "dick",
  "fuck",
  "rape",
  "semen",
];

/** English profanity for names, replacing the excluded dataset entries. */
export const EN_NAME_PATTERNS: readonly string[] = [
  "f[?]ck",
  "|fk|",
  "|fuk|",
  "|fuks|",
  "|fukin",
  "|fuker",
  "dickhead",
  "|dicks|",
  "|dck|",
  "|bigdick",
  "|big dick",
  "|my dick",
  "|mydick",
  "suck dick",
  "suckdick",
  "dicksuck",
  "dick suck",
  "dickface",
  "dickpic",
  "dick pic",
  "|rape|",
  "|rapes|",
  "|raped|",
  "|rapist",
  "|raping",
  "|semen|",
  // The dataset spells these with a double letter that the duplicate collapse
  // removes from the text ("jizz" → "jiz"), so they never matched.
  "|jizz|",
  "buttplug",
];

/**
 * French profanity and obscenity, refused in names. "Con" alone is allowed
 * (an Irish first name, Spanish/Italian "with"); "Fanny" too (a common French
 * first name); "Bite" only as a whole word, so "Bitencourt" passes.
 */
export const FR_NAME_PATTERNS: readonly string[] = [
  "|pute[s]|",
  "|putain[s]|",
  "salope[s]|",
  "|salop|",
  "|salopard",
  "|salaud[s]|",
  "|encul",
  "|nique[s]|",
  "|niquer",
  "|niquez|",
  "|nique ta mere",
  "|niquetamere",
  "|ntm|",
  "|fdp|",
  "|vtff|",
  "|pd[s]|",
  "|bite[s]|",
  "|chatte[s]|",
  "|couille[s]|",
  "|couillon",
  "connard",
  "connasse",
  "|batard",
  "|enfoire",
  "|petasse",
  "|pouffiasse",
  "|poufiasse",
  "|grognasse",
  "|merde[s]|",
  "|merdeu",
  "|merdique",
  "|cul[s]|",
  "trouduc",
  "trou du cul",
  "|suce|",
  "|sucer|",
  "|suceu",
  "|baise[s]|",
  "|baiseu",
  "|baisez|",
  "|branle[s]|",
  "|branler",
  "|branleu",
  "|branlette",
  "|foutre|",
  "|zob[s]|",
  "|teub[e][s]|",
  "|zgeg",
  "|chibre",
  "|nichon",
  "|nibard",
  "|foufoune",
  "|partouze",
  "|sodomi",
];

/**
 * Nazi and hate references in names. "Hitler" anywhere in a name (the exact
 * name "Hitler" is reserved, see `names.ts`); "Heil" and "Nazi" as whole
 * words, so "Heilman", "Nazim" and "Nazir" pass. Number codes ("1488") and
 * "KKK" are matched in `filters.ts`, before leetspeak turns digits into
 * letters.
 */
export const HATE_NAME_PATTERNS: readonly string[] = [
  "hitler",
  "himmler",
  "goebbels",
  "mengele",
  "|heil|",
  "|nazi[s]|",
  "fuhrer",
  "fuehrer",
  "gestapo",
  "auschwitz",
  "zyklon",
  "mein kampf",
  "meinkampf",
  "third reich",
  "thirdreich",
  "troisieme reich",
  "white pride",
  "whitepride",
];

/** Whitelisted terms for names: real names and words caught by a pattern. */
export const NAME_WHITELIST: readonly string[] = [
  // `|anal`: Annalise, Annalisa, Analia, "annales"
  "annal",
  "analis",
  "analia",
  // `orgy`
  "georgy",
  // `|piss`
  "pissarro",
  "pissenlit",
  // `|cum`
  "cumming",
  "cumin",
  "cuma",
  // `|ass`
  "assez",
  "assom",
];

/** Exact names refused as display names (compared after `nameKey`, without separators). */
export const RESERVED_NAMES: readonly string[] = [
  // The site's staff and roles
  "admin",
  "admins",
  "administrateur",
  "administrateurs",
  "administratrice",
  "administration",
  "administrator",
  "administrators",
  "moderateur",
  "moderateurs",
  "moderatrice",
  "moderation",
  "moderator",
  "moderators",
  "modo",
  "modos",
  "mod",
  "mods",
  "staff",
  "support",
  "team",
  "equipe",
  "official",
  "officiel",
  "officielle",
  "system",
  "systeme",
  "root",
  "webmaster",
  // The site itself
  "secret hitler",
  "secret hitler fr",
  "secret hitler en",
  // Labels the site shows in place of a name
  "joueur supprime",
  "joueuse supprimee",
  "compte supprime",
  "deleted player",
  "deleted account",
  "deleted user",
  "vous",
  "you",
  // The game's roles and offices
  "hitler",
  "president",
  "presidente",
  "chancelier",
  "chanceliere",
  "chancellor",
  "liberal",
  "liberale",
  "fasciste",
  "fascist",
];
