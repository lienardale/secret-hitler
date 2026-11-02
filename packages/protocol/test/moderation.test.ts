import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkDisplayName, containsSlur, displayNameSchema, isOffensiveName } from "../src";

describe("chat: slurs are refused", () => {
  it.each([
    // English
    "nigger",
    "you nigger",
    "nigga",
    "faggot",
    "what a fag",
    "kike",
    "chink",
    "spic",
    "coon",
    "tranny",
    "trannies",
    "dyke",
    "wetback",
    "retarded",
    // French
    "nègre",
    "négro",
    "bougnoule",
    "youpin",
    "sale pédé",
    "pédés",
    "tapette",
    "tarlouze",
    "gouine",
    "travelo",
    "chinetoque",
    "mongolien",
    "mongolienne",
    "triso",
  ])("%j", (text) => {
    expect(containsSlur(text)).toBe(true);
  });

  it.each([
    ["leetspeak", "n1gg3r"],
    ["leetspeak", "f4gg0t"],
    ["leetspeak", "p3d3"],
    ["leetspeak, 1 for l", "bougnou1e"],
    ["capitals", "NIGGER"],
    ["accents", "PÉDÉ"],
    ["repeated letters", "niiiiigger"],
    ["repeated letters", "faaaaggot"],
    ["spaced letters", "n i g g e r"],
    ["dotted letters", "n.i.g.g.e.r"],
    ["dashed letters", "p-é-d-é"],
    ["punctuation around", "(fag)"],
    ["punctuation after", "fag!"],
    ["full-width letters", "ｎｉｇｇｅｒ"],
    ["mathematical letters", "𝐧𝐢𝐠𝐠𝐞𝐫"],
    ["inside a sentence", "t'es qu'un sale nègre"],
  ])("%s: %j", (_, text) => {
    expect(containsSlur(text)).toBe(true);
  });

  it.each([
    "sieg heil",
    "Heil Hitler !",
    "juden raus",
    "white power",
    "mort aux juifs",
    "à mort les arabes",
    "il faut gazer tous les juifs",
    "tuez les pédés",
    "sale arabe",
    "sales juifs",
    "les juifs au four",
    "gas the jews",
    "kill all the gays",
    "death to muslims",
    "jews to the ovens",
    "dirty jew",
  ])("Nazi slogans and incitement: %j", (text) => {
    expect(containsSlur(text)).toBe(true);
  });
});

describe("chat: swearing and the game's vocabulary are allowed", () => {
  it.each([
    "merde",
    "putain",
    "putain de merde",
    "fuck",
    "fuck this",
    "shit",
    "con",
    "connard",
    "quel connard ce président",
    "enculé",
    "bitch",
    "Hitler",
    "nazi",
    "les nazis",
    "fasciste",
    "facho",
    "fascist",
    "libéral",
    "chancelier",
    "président",
    "exécuter",
    "tuer",
    "kill",
    "shoot",
    "Hitler est chancelier, on a perdu",
    "il faut exécuter le président",
    "tuer les fascistes",
    "sale fasciste",
    "sale facho",
    "kill the president",
    "shoot Hitler",
    "kill all fascists",
    "death to fascists",
    "Ja ! Nein ! le facho a menti",
  ])("%j", (text) => {
    expect(containsSlur(text)).toBe(false);
  });
});

describe("chat: innocent words that contain a short insult pass", () => {
  it.each([
    // French
    "dispute",
    "une dispute",
    "réputation",
    "député",
    "il députe",
    "imputé",
    "conseil",
    "concours",
    "je suis en retard",
    "retardé",
    "mon abo",
    "un fagot de bois",
    "pédale de vélo",
    "randonnée pédestre",
    "pédiatre",
    "youpi !",
    "une bicoque",
    "ça grouille",
    "la Mongolie",
    "un mongol",
    "trisomie",
    "chinois",
    "le Niger",
    "le Nigeria",
    "juif",
    "arabe",
    "noir",
    "musulman",
    "gay",
    "la salle est sale",
    "sale menteur",
    "raton laveur",
    "Tapis rouge",
    "l'été dernier",
    "gouinette",
    // English
    "computer",
    "Scunthorpe",
    "snigger",
    "a negroni",
    "Montenegro",
    "negro spiritual",
    "Nigel",
    "spicy",
    "raccoon",
    "cocoon",
    "tycoon",
    "Pakistan",
    "Travelodge",
    "Van Dyke",
    "chintz",
    "assassin",
    "analysis",
    "class",
    "therapist",
    "cocktail",
    "Dickens",
    "kung fu",
    "white power ranger",
  ])("%j", (text) => {
    expect(containsSlur(text)).toBe(false);
  });
});

describe("display names", () => {
  it.each([
    // Slurs (every chat slur is also refused in names)
    "Nigger",
    "Faggot",
    "SalePédé",
    // English profanity
    "Fuck",
    "FuckYou",
    "Shit",
    "Bitch",
    "B1tch",
    "Cunt",
    "Asshole",
    "Dickhead",
    "BigDick",
    "Pussy",
    "Whore",
    "Slut",
    "Porn",
    "Rapist",
    // French profanity
    "Pute",
    "Grosse pute",
    "GrossePute",
    "grosse_pute",
    "Fils de pute",
    "Salope",
    "Sal0pe",
    "Enculé",
    "Connard",
    "Connasse",
    "Nique ta mère",
    "NTM",
    "FDP",
    "PD",
    "Bite",
    "GrosseBite",
    "Bite69",
    "Chatte",
    "Couilles",
    "Merde",
    "Trou du cul",
    "Branleur",
    "Pétasse",
    "Bâtard",
    "Putain",
    // Spacing and punctuation tricks
    "p.u.t.e",
    "P U T E",
    "s a l o p e",
    "S-A-L-O-P-E",
    "Ⓟⓤⓣⓔ",
    // Nazi and hate references
    "AdolfHitler",
    "HitlerFan88",
    "Hit1er",
    "HeilHitler",
    "Heil",
    "Sieg Heil",
    "Nazi",
    "GrammarNazi",
    "1488",
    "Jean1488",
    "14-88",
    "KKK",
    "K.K.K",
    "Führer",
    "Gestapo",
    "MeinKampf",
    "WhitePower",
    "SaleArabe",
  ])("%j is offensive", (name) => {
    expect(checkDisplayName(name)).toBe("offensive");
  });

  it.each([
    "Admin",
    "Ad-min",
    "Adm1n",
    "Admin 2",
    "Administratrice",
    "Modérateur",
    "Modération",
    "Moderation",
    "Mod",
    "M0D",
    "Modos",
    "Staff",
    "Équipe",
    "Team",
    "Officiel",
    "Official",
    "Système",
    "Secret Hitler",
    "Secret_Hitler",
    "SecretHitler",
    "Joueur supprimé",
    "Deleted player",
    "Vous",
    "You",
    "Hitler",
    "Président",
    "Chancelière",
    "Chancellor",
    "Libéral",
    "Fasciste",
  ])("%j is reserved", (name) => {
    expect(checkDisplayName(name)).toBe("reserved");
  });

  it.each([
    // The name moderators give on a forced rename
    "Player 12345",
    "Player 00042",
    // French and accented
    "Zoé",
    "Élise",
    "Anaïs",
    "Jean-Luc",
    "Marie-Claude",
    "Clémence",
    "Raphaël",
    "Pénélope",
    "Arsène",
    "Titouan",
    "Fanny",
    "D'Artagnan",
    "Député",
    "Salopette",
    "Couillard",
    "Sucette",
    "Branly",
    "Chattanooga",
    "Le Chat",
    "Con",
    "Gay",
    // Real names close to a listed word
    "Dick",
    "Dick Tracy",
    "Dickson",
    "Bitencourt",
    "Annalise",
    "Analía",
    "Assia",
    "Cassandra",
    "Hassan",
    "Fukuda",
    "Fu",
    "Fagan",
    "Kikelomo",
    "Nigel",
    "Semenov",
    "Georgy",
    "Pissarro",
    "Cuma",
    "Nazim",
    "Nazir",
    "Heilman",
    "Hancock",
    "Scunthorpe",
    "Montenegro",
    "Van Dyke",
    "Putin",
    "Team Rocket",
    "Modeste",
    "Admiral",
    "Le Président",
    // Other scripts
    "李小龍",
    "王芳",
    "さくら",
    "김민준",
    "Дмитрий",
    "Анастасия",
    "محمد",
    "Νίκος",
    "Nguyễn",
    "Łukasz",
    "Søren",
    "Ayşe",
  ])("%j is allowed", (name) => {
    expect(checkDisplayName(name)).toBeNull();
  });

  it("keeps the ticket schema to shape only", () => {
    // A name the word list refuses still parses, so a list update never
    // locks an existing account out of its rooms.
    expect(isOffensiveName("Salope")).toBe(true);
    expect(isOffensiveName("Hitler")).toBe(true);
    expect(displayNameSchema.safeParse("Salope").success).toBe(true);
    expect(displayNameSchema.safeParse("Admin").success).toBe(true);
    expect(displayNameSchema.safeParse("<b>").success).toBe(false);
  });
});

describe("filters module", () => {
  it("imports no zod", () => {
    for (const file of ["filters.ts", "words.ts"]) {
      const source = readFileSync(new URL(`../src/moderation/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/from "zod"/);
    }
  });

  it("checks a long message quickly", () => {
    const message =
      "Je pense que le président est fasciste : il a voté Ja, le chancelier aussi, et Hitler va être élu si on ne fait rien. ".repeat(
        2,
      );
    containsSlur(message);
    const start = performance.now();
    for (let i = 0; i < 100; i++) containsSlur(`${message}${i}`);
    expect((performance.now() - start) / 100).toBeLessThan(5);
  });
});
