/**
 * The room WebSocket: partysocket with a fresh ticket for every attempt
 * (tickets are single-use), no replay of queued messages after a reconnect,
 * a keep-alive the room answers without waking up, and the close codes that
 * end a session for good.
 */
import {
  CLOSE,
  KEEPALIVE_PING,
  RETRYABLE_CLOSE_CODES,
  type ClientMessage,
  type ServerMessage,
} from "@sh/protocol";
import ReconnectingWebSocket from "partysocket/ws";

import type { RoomClientEvent } from "./state";

const KEEPALIVE_MS = 30_000;

export interface RoomConnection {
  send(message: ClientMessage): boolean;
  close(): void;
}

export interface ConnectOptions {
  code: string;
  dispatch: (event: RoomClientEvent) => void;
  /** Defaults to POST /api/rooms/:code/ticket. */
  fetchTicketUrl?: (code: string) => Promise<string>;
  WebSocket?: typeof globalThis.WebSocket;
}

/** Thrown by the ticket fetch when retrying cannot help. */
class FatalTicketError extends Error {
  constructor(readonly reason: "no_guest" | "not_found") {
    super(reason);
  }
}

async function defaultFetchTicketUrl(code: string): Promise<string> {
  const response = await fetch(`/api/rooms/${code}/ticket`, { method: "POST", cache: "no-store" });
  if (response.status === 401) throw new FatalTicketError("no_guest");
  if (response.status === 404) throw new FatalTicketError("not_found");
  if (!response.ok) throw new Error(`ticket ${response.status}`);
  const body = (await response.json()) as { url?: unknown };
  if (typeof body.url !== "string") throw new Error("ticket: no url");
  return body.url;
}

export function connectRoom(options: ConnectOptions): RoomConnection {
  const { code, dispatch } = options;
  const fetchTicketUrl = options.fetchTicketUrl ?? defaultFetchTicketUrl;
  let closedForGood = false;

  const socket: ReconnectingWebSocket = new ReconnectingWebSocket(
    async () => {
      try {
        return await fetchTicketUrl(code);
      } catch (error) {
        if (error instanceof FatalTicketError) {
          // Stop before partysocket schedules another attempt.
          closedForGood = true;
          socket.close();
          dispatch(
            error.reason === "no_guest"
              ? { type: "needsName" }
              : { type: "closed", code: CLOSE.roomNotFound },
          );
        }
        throw error;
      }
    },
    [],
    {
      WebSocket: options.WebSocket,
      maxEnqueuedMessages: 0,
      minReconnectionDelay: 500 + Math.random() * 1000,
      maxReconnectionDelay: 10_000,
      connectionTimeout: 8_000,
      shouldReconnectOnClose: (event) => RETRYABLE_CLOSE_CODES.has(event.code),
    },
  );

  socket.addEventListener("open", () => dispatch({ type: "open" }));
  socket.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string" || event.data === "pong") return;
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    dispatch({ type: "message", message, receivedAt: Date.now() });
  });
  socket.addEventListener("close", (event: CloseEvent) => {
    if (closedForGood) return;
    if (RETRYABLE_CLOSE_CODES.has(event.code)) {
      dispatch({ type: "lost" });
    } else {
      closedForGood = true;
      dispatch({ type: "closed", code: event.code });
    }
  });

  const keepAlive = setInterval(() => {
    if (socket.readyState === socket.OPEN) socket.send(KEEPALIVE_PING);
  }, KEEPALIVE_MS);

  return {
    send(message) {
      if (socket.readyState !== socket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      closedForGood = true;
      clearInterval(keepAlive);
      socket.close(1000, "left");
    },
  };
}
