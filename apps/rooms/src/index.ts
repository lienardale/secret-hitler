/**
 * Rooms Worker entry point.
 *
 * M0 skeleton: a health route and a GameRoom Durable Object that only knows its
 * own room code. The ticket check, WebSocket handling and game logic arrive in
 * M2 (see docs/plan.md § Rooms Worker).
 */
import { DurableObject } from "cloudflare:workers";
import { PROTOCOL_VERSION } from "@sh/protocol";

/** One instance per room code, addressed with `env.GAME_ROOM.getByName(code)`. */
export class GameRoom extends DurableObject<Env> {
  hello(): { room: string | undefined; protocol: number } {
    return { room: this.ctx.id.name, protocol: PROTOCOL_VERSION };
  }
}

export default {
  fetch(request): Response {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
