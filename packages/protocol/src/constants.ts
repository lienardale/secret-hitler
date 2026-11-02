/**
 * Plain constants shared by the browser, the rooms Worker and the website.
 * Nothing here imports zod, so browser code can use these without pulling the
 * schemas into its bundle.
 */

/** Room codes: 5 letters with no vowels, so a code never spells a word. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 5;

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 20;

export const CHAT_MAX_LENGTH = 300;
/** Messages kept by a room (and sent to a player who (re)connects). */
export const CHAT_HISTORY = 300;

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

export const IDENTITY_KINDS = ["user", "guest"] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

export const LANGS = ["fr", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const VISIBILITIES = ["private", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Turn timers. `off` (private rooms only) means no deadline: players take the
 * time they need. `fast` is for quick games and testing.
 */
export const TIMER_PRESETS = ["off", "relaxed", "standard", "fast"] as const;
export type TimerPreset = (typeof TIMER_PRESETS)[number];

export const MAX_SPECTATORS = 20;

/** Larger client messages are rejected before parsing. */
export const MAX_CLIENT_MESSAGE_BYTES = 2048;

/**
 * Keep-alive: the client sends this exact text every 30 s and the room
 * answers `KEEPALIVE_PONG` without waking up (Durable Object auto-response).
 */
export const KEEPALIVE_PING = "ping";
export const KEEPALIVE_PONG = "pong";
