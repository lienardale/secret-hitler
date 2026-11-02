# 008 — partysocket reports its own failures as a close with code 1000

**Observed.** Found while adding the ban handling to the room client (M5): a network blip could
end a room session for good with "La connexion à la salle a été fermée" instead of the
"reconnecting" banner. Reproduced with a script driving partysocket directly.

**Cause.** partysocket (1.3.0) turns its own failures into a close event with code **1000**, a
code the server never sent: a WebSocket `error` event (browsers fire one before an abnormal
close), its connection timeout (8 s here), and a ticket fetch that threw after a drop. Our
client treated 1000 as a normal, final close because 1000 is not in `RETRYABLE_CLOSE_CODES`.
partysocket's copy of the event for `close` listeners also loses the original code, so the
decision has to be taken in `shouldReconnectOnClose`, which receives the original event.

**Fix.** `apps/web/lib/room-client/connection.ts`: `shouldReconnectOnClose` retries 1000 (plus
the retryable codes) unless the client itself closed the socket (`close()`), records the
verdict, and the `close` listener uses that verdict. The rooms Worker never closes a socket
with 1000 on its own (its codes are 4xxx; 1000 only completes a close the client started).

**Check.** `tests/unit/room-connection.test.ts`: "socket error → retried", "ticket fetch failing
after a drop → retried", and the fatal 403 `banned` / `cooldown` cases that must not retry.
