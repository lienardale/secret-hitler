/**
 * Version of the browser ↔ rooms WebSocket protocol. It is sent in the room
 * ticket request and in the server's welcome message; the Worker accepts the
 * current and the previous version so a deploy never strands open tabs.
 */
export const PROTOCOL_VERSION = 1;
