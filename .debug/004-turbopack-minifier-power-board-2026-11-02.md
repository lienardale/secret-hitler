# 004 — Production minifier dropped the 7–8 player power board

**Observed.** Three `/dev/table` fixtures (investigate, investigationResult, specialElection)
crashed the page in the production build only ("fixture investigate: not reached in 500 games").
A 7-player game in that build showed the 5–6 player board (peek, execute, execute). `next dev`
and every test were fine.

**Cause.** Turbopack's production minifier (Next 16.4.3) compiled the engine's

```ts
export const POWER_BOARDS = { "5-6": [...], "7-8": [...], "9-10": [...] };
export function powerBoard(n) {
  if (n <= 6) return POWER_BOARDS["5-6"];
  if (n <= 8) return POWER_BOARDS["7-8"];
  return POWER_BOARDS["9-10"];
}
```

into `function(e){return e<=6||e<=8?s:a}` with only two arrays: the 7–8 board was gone and 7–8
player games got the 5–6 board. The exact trigger was not isolated; the dashed, numeric-looking
keys are the suspect.

**Impact.** Browser code only. Real games were not affected: the rooms Worker computes every
`PlayerView` (including `powerBoard`) and is bundled by esbuild (wrangler), which compiles the
function correctly. The browser only ran the engine in the `/dev/table` sandbox.

**Fix.** Plain identifier keys (`small`, `medium`, `large`) and dot access. The build now emits
`function(e){return e<=6?s:e<=8?a:n}` with three arrays.

**Check.** `tests/e2e/dev-table.spec.ts` renders every fixture on a production build; the
investigate and special-election fixtures fail if a 7–8 player game gets the wrong board. To
look at the output directly after `npm -w @sh/web run build`:

```bash
grep -o 'function(e){return e<=6[^}]*}' apps/web/.next/static/chunks/*.js
```

Worth reporting upstream (Next.js / SWC) with a minimal reproduction.
