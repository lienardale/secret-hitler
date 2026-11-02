import { describe, expect, it } from "vitest";

import {
  CHAT_MAX_LENGTH,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  checkDisplayName,
  generateRoomCode,
  identityKey,
  isRoomCode,
  isSupportedProtocol,
  nameKey,
  normalizeChatText,
  normalizeDisplayName,
  normalizeRoomCode,
} from "../src";

describe("protocol version", () => {
  it("accepts the current version and nothing newer or invalid", () => {
    expect(isSupportedProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocol(PROTOCOL_VERSION + 1)).toBe(false);
    expect(isSupportedProtocol(0)).toBe(false);
    expect(isSupportedProtocol(1.5)).toBe(false);
  });
});

describe("room codes", () => {
  it("never contains a vowel", () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[AEIOUY]/);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it("generates valid codes using every letter", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateRoomCode();
      expect(isRoomCode(code)).toBe(true);
      for (const letter of code) seen.add(letter);
    }
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it("normalizes what a player types", () => {
    expect(normalizeRoomCode("  bcdfg ")).toBe("BCDFG");
    expect(normalizeRoomCode("BCDF")).toBeNull();
    expect(normalizeRoomCode("ABCDE")).toBeNull();
    expect(normalizeRoomCode("BCDFGH")).toBeNull();
  });
});

describe("display names", () => {
  it.each([
    ["Ada", null],
    ["Jean-Luc", null],
    ["Zoé 42", null],
    ["李小龍", null],
    ["O'Neil", null],
    ["A", "length"],
    ["abcdefghijklmnopqrstu", "length"],
    ["-dash", "characters"],
    ["dash-", "characters"],
    ["semi;colon", "characters"],
    ["<b>bold</b>", "characters"],
    ["Admin", "reserved"],
    ["Modérateur", "reserved"],
    ["  hitler ", "reserved"],
  ] as const)("%j → %s", (name, problem) => {
    expect(checkDisplayName(name)).toBe(problem);
  });

  it("collapses spaces and compares without accents or case", () => {
    expect(normalizeDisplayName("  Ada    Lovelace ")).toBe("Ada Lovelace");
    expect(nameKey("ÉLISE")).toBe(nameKey("elise"));
  });

  it("builds identity keys", () => {
    expect(identityKey("user", "abc")).toBe("u:abc");
    expect(identityKey("guest", "xyz")).toBe("g:xyz");
  });
});

describe("chat text", () => {
  it("trims, collapses whitespace and removes control characters", () => {
    expect(normalizeChatText("  hello \n\t world\u0000 ")).toBe("hello world");
    expect(normalizeChatText("a​b")).toBe("a b");
  });

  it("refuses empty and too long messages", () => {
    expect(normalizeChatText("   ")).toBeNull();
    expect(normalizeChatText("x".repeat(CHAT_MAX_LENGTH))).toHaveLength(CHAT_MAX_LENGTH);
    expect(normalizeChatText("x".repeat(CHAT_MAX_LENGTH + 1))).toBeNull();
  });
});
