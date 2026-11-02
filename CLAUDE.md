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
npm run dev:setup                 # once: local ticket keys + HMAC secrets (gitignored)
npm -w @sh/rooms run dev          # wrangler dev, :8787
npm -w @sh/rooms run test         # rooms tests, inside workerd
npm run bots -- --players 7 --timers fast [--kill-one]   # bots play a game on wrangler dev
npm -w @sh/rooms run ticket -- --create                  # a ticket + URL to poke at by hand
npm -w @sh/web run db:up          # Docker Postgres on :5434 (docker-compose.yml), migrates sh + sh_test
npm -w @sh/web run dev            # next dev, :3000 (needs dev:setup, db:up and the rooms Worker)
npm -w @sh/web run test           # web unit (node) + ui (jsdom) + integration (real Postgres sh_test)
npm -w @sh/web run test:integration
npm -w @sh/web run admin:grant -- <email>   # make an account ADMIN
npm -w @sh/web run build && npm -w @sh/web run e2e   # Playwright (RUN_E2E=1 adds it to ci.sh)
# e2e beside a wrangler dev already on :8787: build with ROOMS_URL=http://localhost:8788, run with
# PLAYWRIGHT_ROOMS_PORT=8788 (its own wrangler, own local state in apps/rooms/.wrangler/e2e)
bash scripts/ci.sh                # local mirror of CI (SKIP_BUILD=1 to skip builds)
npm -w @sh/rooms run deploy:staging   # Cloudflare (needs `npx wrangler login`)
vercel deploy --prod                  # from the repo root (linked to secret-hitler-staging)
```

Deploys, secrets and the staging URLs are in `docs/deploy.md`. Never print a secret: write it to a
mode-600 file and pipe it into `vercel env add` / `wrangler secret put`.

The rooms Worker is documented in `docs/protocol.md` (tickets, messages, close codes, room
rules). The room rules live in `apps/rooms/src/room/room-core.ts`, a pure class tested with a
fake clock; `GameRoom.ts` is only the Durable Object shell (SQLite, sockets, alarm).

The website (`apps/web`): `components/game/` is the game table (pure, driven by a `PlayerView`;
try it at `/fr/dev/table`, a local engine sandbox shown only with `ENABLE_TEST_PAGES=1`),
`components/room/` the room around it (lobby, chat, host controls), `lib/room-client/` the
socket and its store, `lib/guest/` the guest cookie, `lib/rooms/` the signed calls and tickets.
Server env is checked by `lib/env.ts`. Browser code must not import protocol modules that build
zod schemas: plain constants live in `packages/protocol/src/constants.ts`.

Accounts (M4): `auth.ts` (Auth.js, used only to sign in/out), `lib/auth/` (credentials check,
session token, `current-user.ts`, verification links, display names), `app/[locale]/(auth)/`
(sign-in/up, `/bienvenue` onboarding, `/verifier-email`), `app/[locale]/profil/` (history,
blocks, rename, deletion), `app/[locale]/jouer/` (public lobby + quick match),
`app/api/internal/games` (results from the rooms outbox, `lib/games/`). Prisma schema and
migrations in `apps/web/prisma/`, client in `lib/db/prisma.ts`.

## Rules that matter

- **The engine is pure.** `packages/engine/src` has no I/O, clock or `Math.random`
  (ESLint enforces it). Randomness comes from the seeded RNG stored in the state.
- **Hidden information.** Clients only ever receive `viewFor(state, viewer)` output.
  Never send or log the full state, the deck order, hands or the seed. In `apps/rooms`, only
  `src/room/connections.ts` (and the lobby) may call `.send(` (ESLint enforces it), and every
  outgoing message is checked against the strict protocol schemas outside production.
- **No external calls in the message path.** Results to the website go through the room's
  outbox and the lobby is updated from the alarm.
- **Rules are checked against the official PDF** (`docs/plan.md` § Rules engine lists the
  subtle ones: tracker reset only on enactment, chaos ignores powers and the Hitler check,
  reshuffle mixes the remaining deck with the discards, term limits relax at ≤ 5 alive).
- **License.** CC BY-NC-SA 4.0. No ads, no paid features, no app stores. Every rule change
  compared with the board game goes into the "What we changed" list in `CREDITS.md`.
- **Reading the session.** Server code reads the account with `getCurrentUser()` /
  `requireOnboardedUser()` (`lib/auth/current-user.ts`), never Auth.js's `auth()`: that one
  rewrites the cookie on every call and races sign-out (`.debug/005`). The proxy never touches the
  session. The JWT holds only `id` + `sv` (sessionVersion); bump `User.sessionVersion` to sign an
  account out everywhere.
- **Prisma.** Import the client only from `@/lib/generated/prisma/client` (generated, gitignored;
  `postinstall` runs `prisma generate`). Errors are logged by our listener (`lib/db/log.ts`), which
  drops only named expected lines; never add Prisma's own `"error"` stdout logging. New
  migrations: `npx prisma migrate diff … --script` into a new folder (never merge stderr into it,
  `.debug/006`), then `npm -w @sh/web run db:migrate` / `db:migrate:test`. Integration and e2e
  tests only ever touch a local `*_test` database (`tests/_db/test-db.ts` refuses anything else).
- **Forms.** Server actions return message keys, never throw expected failures, check the
  origin first, and send back what was typed (React resets forms after an action, `.debug/007`).
- Package manager: npm (workspaces). TypeScript stays on 5.x (TS 7 breaks next build); ESLint 10.
- Non-obvious findings go in `.debug/NNN-description-YYYY-MM-DD.md` with an index line.
