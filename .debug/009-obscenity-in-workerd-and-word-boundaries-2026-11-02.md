# 009 — obscenity: workerd test loading, ASCII word boundaries, doubled letters

Met while building the word filters (`packages/protocol/src/moderation/`, M5).

## Every rooms test file failed to load

**Observed.** After `@sh/protocol` started importing `obscenity`, `npm -w @sh/rooms run test`
failed in 7 of 8 files with `TypeError: Cannot read properties of undefined (reading 'DataSet')`
at a generated `export const ParserError = mod.ParserError;`. `wrangler deploy --dry-run`, Node
and Next were fine.

**Cause.** obscenity ships CommonJS behind a thin `.mjs` wrapper (`import mod from "./index.js"`).
`@cloudflare/vitest-plugin` forces `server.deps.inline = true`, so Vite transforms the wrapper as
ESM and the default import of the CommonJS file comes back `undefined`. The wrapper throws while
it is evaluated, before any of our code runs, so no import trick in our code can help.

**Fix.** `apps/rooms/vitest.config.ts`: `test.deps.optimizer.ssr = { enabled: true, include:
["obscenity"] }` pre-bundles it with esbuild into real ESM.

## Accented words matched as slurs

obscenity's `|` word boundaries are ASCII-only: in "députe", `é` counts as a boundary, so "pute"
looked like a word. The filters fold accents (NFKD, marks removed) before matching.

## Patterns that can never match

obscenity's recommended transformers collapse repeated letters ("jizz" → "jiz") before matching,
so a dataset pattern spelled with a double letter never matches. Two of its own English
patterns were dead; `words.ts` adds working versions. Write patterns with single letters.

**Check.** `packages/protocol/test/moderation.test.ts` (slurs, innocent words such as
"député", "dispute", "réputation", "Scunthorpe") and a green `npm -w @sh/rooms run test`.
