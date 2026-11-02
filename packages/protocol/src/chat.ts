/**
 * In-room text chat. Player messages carry the author's room id and name;
 * system messages carry an i18n key so each viewer reads them in their own
 * language.
 */
import { z } from "zod";

export const CHAT_MAX_LENGTH = 300;
/** Messages kept by a room (and sent to a player who (re)connects). */
export const CHAT_HISTORY = 300;

/**
 * NFC, control characters removed, runs of whitespace collapsed, trimmed.
 * Returns null for an empty or too long message.
 */
export function normalizeChatText(raw: string): string | null {
  const text = raw
    .normalize("NFC")
    .replace(/\p{Cc}|\p{Cf}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0 || [...text].length > CHAT_MAX_LENGTH) return null;
  return text;
}

export const SYSTEM_MESSAGE_KEYS = [
  "playerJoined",
  "playerLeft",
  "playerKicked",
  "hostChanged",
  "gameStarted",
  "gameEnded",
  "gameAbandoned",
  "playerAfk",
  "playerBack",
  "turnForced",
] as const;

export type SystemMessageKey = (typeof SYSTEM_MESSAGE_KEYS)[number];

export const chatMessageSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("player"),
    id: z.int().nonnegative(),
    at: z.int(),
    pid: z.string(),
    name: z.string(),
    text: z.string().max(CHAT_MAX_LENGTH * 2),
  }),
  z.strictObject({
    kind: z.literal("system"),
    id: z.int().nonnegative(),
    at: z.int(),
    key: z.enum(SYSTEM_MESSAGE_KEYS),
    /** Values for the message template, e.g. `{ name: "Ada" }`. */
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  }),
]);

export type ChatMessage = z.infer<typeof chatMessageSchema>;
