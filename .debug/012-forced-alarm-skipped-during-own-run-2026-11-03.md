# 012 — A forced alarm does nothing while the room's own alarm is running

**Observed.** `apps/rooms/test/game-room.test.ts` › "delivers the result to the website" failed
now and then on CI with `expected 0 to be greater than or equal to 1`: after
`runDurableObjectAlarm(stub)`, no request had reached the mocked `fetch`. It passed on rerun.

**Cause.** The room sets its alarm 50 ms (outbox) to 1 s (lobby debounce) after a change, and on
a busy machine that alarm fires by itself before the test forces it. While that run is in
progress, workerd treats the alarm as used: `storage.getAlarm()` returns `null` until the
handler sets the next one. `runDurableObjectAlarm` starts with
`if (await getAlarm() === null) return false`, so it runs nothing, and a check made right after
it sees the state from before the room's own run. The room's own run is not instant: the
plugin's Durable Object wrapper first imports the module through the runner object, then the
outbox signs the request with Web Crypto.

The room's own run does go through `vi.spyOn(globalThis, "fetch")` (same isolate); only the
timing was wrong. Measured locally: forcing 43–48 ms after the game ended skipped the forced
alarm and found 0 requests, with 1 request a moment later.

**Fix.** The alarm tests use `alarmUntil(stub, check)`: force the alarm, then run `check`, in a
`vi.waitFor` (5 s, every 20 ms), so the check passes whichever run did the work. Do not assert
`runDurableObjectAlarm(...)` returns `true` unless nothing else can have fired the alarm.

**Check.** Throwaway sweeps forcing the alarm inside the window: the old checks failed (delivery
test at 45 ms; lobby test at 990–998 ms, room not listed yet), `alarmUntil` passed at every
delay. The four alarm tests passed 20 runs in a row.
