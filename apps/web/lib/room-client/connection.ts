/**
 * The room WebSocket: partysocket with a fresh ticket for every attempt
 * (tickets are single-use), no replay of queued messages after a reconnect,
 * a keep-alive the room answers without waking up, and the close codes that
 * end a session for good.
 *
 * partysocket reports its own failures (a WebSocket `error`, a connection
 * timeout, a ticket fetch that threw) as a close with code 1000 that the
 * server never sent. Those are retried like a network drop; the room itself
 * never closes a socket with 1000 unless the client asked (`close()`).
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
  /**
   * Drops the socket and connects again with a fresh ticket (after a block:
   * the new ticket carries it). Nothing is dispatched for the drop itself; the
   * new `welcome` replaces the state.
   */
  reconnect(): void;
  close(): void;
}

export interface ConnectOptions {
  code: string;
  dispatch: (event: RoomClientEvent) => void;
  /** Defaults to POST /api/rooms/:code/ticket. */
  fetchTicketUrl?: (code: string) => Promise<string>;
  WebSocket?: typeof globalThis.WebSocket;
}

type FatalReason = "no_guest" | "not_found" | "banned" | "cooldown";

/** Thrown by the ticket fetch when retrying cannot help. */
class FatalTicketError extends Error {
  constructor(
    readonly reason: FatalReason,
    /** `cooldown`: when the account may join a public room again (ms since epoch). */
    readonly until: number | null = null,
  ) {
    super(reason);
  }
}

function fatalEvent(error: FatalTicketError): RoomClientEvent {
  switch (error.reason) {
    case "no_guest":
      return { type: "needsName" };
    case "not_found":
      return { type: "closed", code: CLOSE.roomNotFound };
    case "banned":
      // A suspended account: the same notice as a live socket the room closed.
      return { type: "closed", code: CLOSE.banned };
    case "cooldown":
      return { type: "cooldown", until: error.until };
  }
}

async function bodyOf(response: Response): Promise<{ error?: unknown; until?: unknown }> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? body : {};
  } catch {
    return {};
  }
}

/**
 * The ticket route's answers that end the session: 401 no guest (ask for a
 * name), 404, and 403 `banned` (suspended account) or `cooldown` (an account
 * that left two public games within 24 h, for a public room still in its
 * lobby). Any other failure is retried.
 */
async function defaultFetchTicketUrl(code: string): Promise<string> {
  const response = await fetch(`/api/rooms/${code}/ticket`, { method: "POST", cache: "no-store" });
  if (response.status === 401) throw new FatalTicketError("no_guest");
  if (response.status === 404) throw new FatalTicketError("not_found");
  if (response.status === 403) {
    const body = await bodyOf(response);
    if (body.error === "banned") throw new FatalTicketError("banned");
    if (body.error === "cooldown") {
      const until =
        typeof body.until === "number" && Number.isFinite(body.until) ? body.until : null;
      throw new FatalTicketError("cooldown", until);
    }
  }
  if (!response.ok) throw new Error(`ticket ${response.status}`);
  const body = (await response.json()) as { url?: unknown };
  if (typeof body.url !== "string") throw new Error("ticket: no url");
  return body.url;
}

export function connectRoom(options: ConnectOptions): RoomConnection {
  const { code, dispatch } = options;
  const fetchTicketUrl = options.fetchTicketUrl ?? defaultFetchTicketUrl;
  let closedForGood = false;
  /** Inside `reconnect()`: the close it causes is ours. */
  let restarting = false;
  /**
   * The verdict on the latest close, taken where partysocket hands over the
   * original event (its copy for listeners loses the code of its own events).
   */
  let retryLastClose = false;

  const socket: ReconnectingWebSocket = new ReconnectingWebSocket(
    async () => {
      try {
        return await fetchTicketUrl(code);
      } catch (error) {
        if (error instanceof FatalTicketError) {
          // Stop before partysocket schedules another attempt.
          closedForGood = true;
          socket.close();
          dispatch(fatalEvent(error));
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
      shouldReconnectOnClose: (event) => {
        retryLastClose =
          !closedForGood &&
          (restarting || event.code === 1000 || RETRYABLE_CLOSE_CODES.has(event.code));
        return retryLastClose;
      },
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
    if (closedForGood || restarting) return;
    if (retryLastClose) {
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
    reconnect() {
      if (closedForGood) return;
      restarting = true;
      try {
        socket.reconnect(1000, "reconnect");
      } finally {
        restarting = false;
      }
    },
    close() {
      closedForGood = true;
      clearInterval(keepAlive);
      socket.close(1000, "left");
    },
  };
}
