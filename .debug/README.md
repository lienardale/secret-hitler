# Debug notes

One file per non-obvious finding: `.debug/NNN-description-YYYY-MM-DD.md`.
Each note says what was observed, the cause, the fix and how to check it.
Add a line to the index below when you add a note.

## Index

- [001](001-rng-seeding-2026-11-02.md) — RNG seeding: every seed word must reach the first output
- [002](002-websocket-close-handshake-2026-11-02.md) — Client-initiated WebSocket close never completed
- [003](003-workerd-test-pitfalls-2026-11-02.md) — RPC promises with `rejects`, request bodies across Durable Objects
- [004](004-turbopack-minifier-power-board-2026-11-02.md) — Production minifier dropped the 7–8 player power board (browser only)
- [005](005-auth-session-cookie-writes-2026-11-02.md) — Why the website never calls Auth.js's `auth()` (cookie writes race sign-out)
- [006](006-prisma-cli-pitfalls-2026-11-02.md) — Prisma's update banner in generated SQL; `migrate reset` refuses agents
- [007](007-react-form-reset-after-action-2026-11-02.md) — React 19 resets forms after an action: refused forms came back empty
