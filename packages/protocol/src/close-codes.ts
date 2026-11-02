/**
 * WebSocket close codes sent by the rooms Worker. The client uses them to
 * decide whether to reconnect and what to tell the player.
 */
export const CLOSE = {
  /** Malformed messages, too many of them, or a message that is too large. */
  badRequest: 4400,
  /** Ticket missing, invalid, expired, already used, or for another room. */
  unauthorized: 4401,
  /** A guest tried to join a public room. */
  accountRequired: 4403,
  /** No room with this code (never created, or already closed). */
  roomNotFound: 4404,
  /** No free place left (10 players and 20 spectators). */
  roomFull: 4409,
  /** The room was closed after the game, or for inactivity. */
  roomClosed: 4410,
  /** The host removed this player from the room. */
  kicked: 4423,
  /** The client speaks a protocol version this Worker no longer accepts: reload the page. */
  protocolMismatch: 4426,
  /** Too many chat messages or actions in a short time. */
  flood: 4429,
  /** A moderator suspended this account: don't retry, show the suspension notice. */
  banned: 4451,
} as const;

export type CloseCode = (typeof CLOSE)[keyof typeof CLOSE];

/**
 * Closes after which the client should reconnect (with a fresh ticket).
 * 1001/1006/1011 cover deploys, network drops and server restarts; an
 * expired ticket is fixed by fetching a new one.
 */
export const RETRYABLE_CLOSE_CODES: ReadonlySet<number> = new Set([
  1001,
  1006,
  1011,
  1012,
  1013,
  CLOSE.unauthorized,
]);
