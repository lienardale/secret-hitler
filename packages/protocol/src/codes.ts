/**
 * Room codes: 5 letters from an alphabet without vowels, so a code never
 * spells a word by accident. 20^5 = 3.2 million codes.
 */
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants";

export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(value);
}

/** Uppercases and trims what a player typed; returns null if it is not a valid code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return isRoomCode(code) ? code : null;
}

/** A new random room code (uses the platform's crypto RNG). */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH * 2);
  let code = "";
  while (code.length < ROOM_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 240 = 12 × 20: reject higher bytes so every letter is equally likely.
      if (byte < 240 && code.length < ROOM_CODE_LENGTH) {
        code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      }
    }
  }
  return code;
}
