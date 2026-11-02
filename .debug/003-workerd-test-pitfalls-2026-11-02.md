# 003 — Two pitfalls when testing Durable Objects in workerd

Both met while writing `apps/rooms/test` with `@cloudflare/vitest-plugin`.

## RPC promises and `expect(...).rejects`

**Observed.** `await expect(stub.method(bad)).rejects.toThrow()` on a Durable Object RPC call
produced "Unhandled Rejection" errors that failed the run.

**Cause.** Vitest reads properties on the promise it is given. On an RPC promise, every property
read starts a pipelined RPC call, and those extra calls reject unhandled.

**Fix.** Await the call inside a try/catch and assert on the caught error (`rpcError()` helper in
`test/lobby.test.ts`). workerd still logs `uncaught exception … ZodError` for those deliberate
bad calls; that is server-side logging and does not fail the run.

## Request bodies created inside a Durable Object

**Observed.** A test that spied on `fetch` and stored the `Request` objects failed with "Cannot
perform I/O on behalf of a different Durable Object" when it later read `request.text()`.

**Cause.** I/O objects (streams, bodies) belong to the context that created them; the spy ran in
the room's context, the assertion in the test's.

**Fix.** Copy what you need (URL, headers, the string body) inside the mock implementation.
See `test/game-room.test.ts` › "delivers the result to the website".

## Bonus: controlling time

`vi.spyOn(Date, "now")` reaches the Durable Objects, because they run in the test isolate. Tests
use it with `runDurableObjectAlarm` to jump past deadlines instead of making the clock injectable.
