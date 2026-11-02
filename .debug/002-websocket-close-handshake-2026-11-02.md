# 002 — Client-initiated WebSocket close never completed

**Observed.** In the rooms tests, a client that called `ws.close()` never received its own `close`
event: `await client.closeCode()` timed out. The room did get `webSocketClose`.

**Cause.** With the Durable Object hibernation API, the server side must answer the close frame.
The compatibility flag that makes the runtime reply automatically was not in effect for our
setup, so the handshake stayed half-open.

**Fix.** `webSocketClose(ws, code)` in `GameRoom` and `Lobby` calls `ws.close(code, "bye")` inside
a try/catch (a no-op if the runtime already answered). Reserved codes (1005, 1006, 1015) cannot
be sent, so they are mapped to 1000.

**Check.** `test/game-room.test.ts` › "gives a reconnecting player their seat back" closes a
client and waits for the close event.
