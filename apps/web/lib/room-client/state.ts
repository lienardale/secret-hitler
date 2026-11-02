/**
 * Client-side state of one room, built only from what the room sends
 * (docs/protocol.md). Pure: `reduce(state, event)` is tested on its own; the
 * store and the socket live in store.ts and connection.ts.
 */
import type { GameEvent, PlayerView } from "@sh/engine";
import type { ChatMessage, ErrorCode, RoomView, ServerMessage } from "@sh/protocol";

export type ConnectionStatus =
  /** First connection attempt (or after the tab came back). */
  | "connecting"
  | "open"
  /** Lost the connection; partysocket is retrying with a fresh ticket. */
  | "reconnecting"
  /** Closed for good: see `closeCode` (kicked, room closed, no such room…). */
  | "closed";

export interface RoomClientState {
  status: ConnectionStatus;
  /** Why the room closed for good (a CLOSE code), or a local reason. */
  closeCode: number | null;
  /**
   * The ticket route refused an account in the abandon cooldown (2 public
   * games left within 24 h) a public room: when it may join again (ms since
   * epoch, null if the route did not say). Client-only: no socket was opened.
   */
  cooldown: { until: number | null } | null;
  /** The ticket route said there is no guest: the page must ask for a name. */
  needsName: boolean;
  you: { pid: string; name: string } | null;
  room: RoomView | null;
  game: { turn: number; view: PlayerView; log: GameEvent[] } | null;
  chat: ChatMessage[];
  /** Server clock minus local clock, from the last message that carried `serverTime`. */
  clockOffset: number;
  /** The last refusal of one of our messages, for a short notice. */
  lastError: { code: ErrorCode; at: number } | null;
  /** An action of ours is in flight: controls stay disabled until the room answers. */
  actionPending: boolean;
}

export const initialRoomState: RoomClientState = {
  status: "connecting",
  closeCode: null,
  cooldown: null,
  needsName: false,
  you: null,
  room: null,
  game: null,
  chat: [],
  clockOffset: 0,
  lastError: null,
  actionPending: false,
};

export type RoomClientEvent =
  | { type: "open" }
  | { type: "lost" }
  | { type: "closed"; code: number }
  | { type: "needsName" }
  | { type: "cooldown"; until: number | null }
  | { type: "actionSent" }
  | { type: "message"; message: ServerMessage; receivedAt: number };

/** Chat ids only grow; a message may repeat one already in a welcome. */
function appendChat(chat: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const last = chat.at(-1);
  if (last && message.id <= last.id) return chat;
  const next = [...chat, message];
  return next.length > 300 ? next.slice(-300) : next;
}

function onMessage(state: RoomClientState, message: ServerMessage, now: number): RoomClientState {
  switch (message.t) {
    case "welcome":
      return {
        ...state,
        status: "open",
        closeCode: null,
        you: message.you,
        room: message.room,
        game: message.game,
        chat: message.chat,
        clockOffset: message.serverTime - now,
        actionPending: false,
      };
    case "room":
      return {
        ...state,
        room: message.room,
        // A game that ended and went back to the lobby (rematch) has no view any more.
        game: message.room.status === "lobby" ? null : state.game,
        clockOffset: message.serverTime - now,
      };
    case "game":
      return {
        ...state,
        game: {
          turn: message.turn,
          view: message.view,
          log: [...(state.game?.log ?? []), ...message.events],
        },
        actionPending: false,
      };
    case "chat":
      return { ...state, chat: appendChat(state.chat, message.message) };
    case "error":
      return { ...state, lastError: { code: message.code, at: now }, actionPending: false };
  }
}

export function reduce(state: RoomClientState, event: RoomClientEvent): RoomClientState {
  switch (event.type) {
    case "open":
      // The welcome that follows carries the state; until then we are still connecting.
      return state.status === "closed" ? state : { ...state, needsName: false };
    case "lost":
      return state.status === "closed"
        ? state
        : { ...state, status: "reconnecting", actionPending: false };
    case "closed":
      return { ...state, status: "closed", closeCode: event.code, actionPending: false };
    case "needsName":
      return { ...state, status: "closed", needsName: true, actionPending: false };
    case "cooldown":
      return {
        ...state,
        status: "closed",
        closeCode: null,
        cooldown: { until: event.until },
        actionPending: false,
      };
    case "actionSent":
      return { ...state, actionPending: true };
    case "message":
      return onMessage(state, event.message, event.receivedAt);
  }
}
