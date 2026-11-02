/**
 * Version of the browser ↔ rooms WebSocket protocol. It is carried in the room
 * ticket (`pv`) and in the server's welcome message. The Worker accepts the
 * current and the previous version so a deploy never strands open tabs.
 */
export const PROTOCOL_VERSION = 1;

/** Oldest version ever published; nothing below it exists. */
const FIRST_PROTOCOL_VERSION = 1;

export function isSupportedProtocol(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= Math.max(FIRST_PROTOCOL_VERSION, PROTOCOL_VERSION - 1) &&
    version <= PROTOCOL_VERSION
  );
}
