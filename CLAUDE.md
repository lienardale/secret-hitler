# CLAUDE.md

Guidance for Claude Code in this repository. The plan is `docs/plan.md`.

## Shell preamble

The Bash tool does not load `~/.zshrc`, so Node is not on PATH. Start Node commands with:

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null && cd /Users/alienard/Code/secret-hitler &&
```

## Commands

```bash
npm test                          # every workspace
npm -w @sh/engine run test        # rules engine (unit + property tests)
npm -w @sh/engine run simulate -- --games 20000
npm -w @sh/rooms run dev          # wrangler dev, :8787
npm -w @sh/web run dev            # next dev, :3000
bash scripts/ci.sh                # local mirror of CI (SKIP_BUILD=1 to skip builds)
```

## Rules that matter

- **The engine is pure.** `packages/engine/src` has no I/O, clock or `Math.random`
  (ESLint enforces it). Randomness comes from the seeded RNG stored in the state.
- **Hidden information.** Clients only ever receive `viewFor(state, viewer)` output.
  Never send or log the full state, the deck order, hands or the seed.
- **Rules are checked against the official PDF** (`docs/plan.md` § Rules engine lists the
  subtle ones: tracker reset only on enactment, chaos ignores powers and the Hitler check,
  reshuffle mixes the remaining deck with the discards, term limits relax at ≤ 5 alive).
- **License.** CC BY-NC-SA 4.0. No ads, no paid features, no app stores. Every rule change
  compared with the board game goes into the "What we changed" list in `CREDITS.md`.
- Package manager: npm (workspaces). TypeScript stays on 5.x (TS 7 breaks next build); ESLint 10.
- Non-obvious findings go in `.debug/NNN-description-YYYY-MM-DD.md` with an index line.
