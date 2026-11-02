/**
 * The only module that sends on a room's WebSockets (ESLint enforces it).
 *
 * Game data always goes through the room core's per-member builders, which
 * call the game module's `view` / `eventsFor`. Outside production every
 * outgoing message is checked against the strict protocol schemas, so a
 * field that should not leave the server fails loudly in development and
 * tests.
 */
import { serverMessageSchema } from "@sh/protocol";

import type { RoomCore } from "./room-core";
import type { Note } from "./room-state";

interface Attachment {
  pid: string;
}

export class Connections {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly validate: boolean,
  ) {}

  /** Open sockets, optionally only those of one member (tagged with their pid). */
  sockets(pid?: string): WebSocket[] {
    return this.ctx.getWebSockets(pid).filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  attachment(ws: WebSocket): Attachment | null {
    const value = ws.deserializeAttachment() as Attachment | null;
    return value && typeof value.pid === "string" ? value : null;
  }

  /** Pids that have at least one open socket (survives hibernation). */
  onlinePids(): Set<string> {
    const pids = new Set<string>();
    for (const ws of this.sockets()) {
      const attachment = this.attachment(ws);
      if (attachment) pids.add(attachment.pid);
    }
    return pids;
  }

  accept(ws: WebSocket, pid: string): void {
    this.ctx.acceptWebSocket(ws, [pid]);
    ws.serializeAttachment({ pid } satisfies Attachment);
  }

  private encode(message: unknown): string {
    if (this.validate) {
      const parsed = serverMessageSchema.safeParse(message);
      if (!parsed.success) {
        throw new Error(`refusing to send an invalid message: ${parsed.error.message}`);
      }
    }
    return JSON.stringify(message);
  }

  private sendRaw(ws: WebSocket, data: string): void {
    try {
      ws.send(data);
    } catch {
      // The socket closed in the meantime; its close handler cleans up.
    }
  }

  send(ws: WebSocket, message: unknown): void {
    this.sendRaw(ws, this.encode(message));
  }

  welcome<S, A, V, E>(ws: WebSocket, core: RoomCore<S, A, V, E>, pid: string, now: number): void {
    const welcome = core.welcomeFor(pid, now);
    if (welcome) this.send(ws, welcome);
  }

  dispatch<S, A, V, E>(core: RoomCore<S, A, V, E>, notes: readonly Note<E>[], now: number): void {
    if (notes.length === 0) return;
    const all = this.sockets();
    for (const note of notes) {
      switch (note.kind) {
        case "room": {
          const data = this.encode({ t: "room", room: core.roomView(), serverTime: now });
          for (const ws of all) this.sendRaw(ws, data);
          break;
        }
        case "snapshot":
          for (const ws of all) {
            const pid = this.attachment(ws)?.pid;
            if (pid) this.welcome(ws, core, pid, now);
          }
          break;
        case "game":
          for (const ws of all) {
            const pid = this.attachment(ws)?.pid;
            const update = pid ? core.gameUpdateFor(pid, note.events) : null;
            if (update) this.send(ws, update);
          }
          break;
        case "chat": {
          const data = this.encode({ t: "chat", message: note.chat.message });
          for (const ws of all) {
            const pid = this.attachment(ws)?.pid;
            if (pid && core.chatVisibleTo(note.chat, pid)) this.sendRaw(ws, data);
          }
          break;
        }
        case "close":
          for (const ws of this.sockets(note.pid)) ws.close(note.code, "closed by the room");
          break;
      }
    }
  }

  closeAll(code: number, reason: string): void {
    for (const ws of this.sockets()) ws.close(code, reason);
  }
}
