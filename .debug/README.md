# Debug notes

One file per non-obvious finding: `.debug/NNN-description-YYYY-MM-DD.md`.
Each note says what was observed, the cause, the fix and how to check it.
Add a line to the index below when you add a note.

## Index

- [001](001-rng-seeding-2026-11-02.md) — RNG seeding: every seed word must reach the first output
- [002](002-websocket-close-handshake-2026-11-02.md) — Client-initiated WebSocket close never completed
- [003](003-workerd-test-pitfalls-2026-11-02.md) — RPC promises with `rejects`, request bodies across Durable Objects
