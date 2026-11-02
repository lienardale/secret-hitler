# Secret Hitler online platform — Plan

## Context

The user wants a free web platform to play **Secret Hitler** online, either privately with friends (link or room code) or publicly with strangers. Before planning they asked for two web searches: the Secret Hitler PDF, and the online adaptation of *Les Loups-Garous de Thiercelieux* (a reference for running a public social-deduction site). New project folder: `/Users/alienard/Code/secret-hitler` (does not exist yet).

### Research findings

**Secret Hitler (source material and license)**
- Official files: rules `https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf`, print & play `https://www.secrethitler.com/assets/Secret_Hitler_Print_and_Play.pdf`.
- License **CC BY-NC-SA 4.0** (© Goat, Wolf & Cabbage). Credit, no commercial use, same license for adaptations, **say what you changed**, no app-store submission without their approval. The current rules PDF credits *"Mike Boxleiter, Tommy Maranges, and Mac Schubert"* — copy that line exactly.
- Official print & play is low-quality B&W. yingtongli.me published editable colour SVGs under the same license (fonts inside are not CC: use OFL substitutes and outline text).
- Existing clones, both CC BY-NC-SA, both credit the designers: secrethitler.io (`cozuya/secret-hitler`, React + Socket.IO + Node + MongoDB + Redis, public lobby, custom games) and secret-hitler.online (`ShrimpCryptid/Secret-Hitler-Online`, React + Java WebSockets, private lobbies only).

**Loups-Garous de Thiercelieux online**
- The official web adaptation *Loups-Garous en ligne* (loups-garous-en-ligne.com) **closed its browser version on 9 Jan 2024**; mobile apps remained. It had game types (Fun, Sérieux, Normal, Carnage), up to 50 players, 29 roles. The site blocks automated reading (Cloudflare), so details come from secondary sources.
- **Wolfy** (wolfy.net / wolfy.fr) is the main active unofficial version: browser + iOS/Android, ~30 roles, seasonal leaderboard, cosmetic avatars, private games. Reviews criticise moderation and how new players are treated in public games → this plan builds reporting, blocking and moderation into v1, not later.

### Decisions taken with the user (2026-11-01)
- Keep the official name and art under CC BY-NC-SA: free, no ads or paid features, web only, credits page.
- Secret Hitler only; the rules engine stays behind a small `GameModule` interface so another hidden-role game can plug in later. No plugin framework.
- Live rooms on **Cloudflare Workers + Durable Objects** (one per room, state survives deploys). Website on **Next.js 16 (Vercel cdg1)** + Neon Postgres.
- v1 = private games (guests allowed) + public games with strangers (accounts, lobby, quick match, reports, moderation) + in-game text chat. Not in v1: ranked/Elo, voice, replay UI (event log stored for later), bots in public games.
- French + English.

### Decisions taken with the user (2026-11-02, M4)
- Staging database: Neon free plan through the Vercel Marketplace (resource `sh-staging`, `fra1`).
- E-mail verification is built now with a dev mail sink (`MAIL_TRANSPORT=log`); real sending and
  the "verified e-mail for public play" rule (`REQUIRE_EMAIL_VERIFICATION`) are switched on once a
  domain exists (M6). The e2e suite runs with the rule on.
- Google sign-in is coded and turns on when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set; the
  user creates the OAuth client later.

### Decisions taken with the user (2026-11-02, M6)
- **No domain.** The site is mostly for the user's friends. Production is the existing Vercel
  project `secret-hitler-staging` (`https://secret-hitler-staging.vercel.app`) and the Worker
  `sh-rooms-staging` on `workers.dev`. So no Resend: no e-mail is sent, and
  `REQUIRE_EMAIL_VERIFICATION` stays off. The contact address stays `CONTACT_EMAIL`
  (alienard.dev@gmail.com).
- **Legal notice: anonymous non-professional publisher** (LCEN art. 6-III-2). The identity is
  held by the host (Vercel); the page gives the contact address and the hosts. Set in
  `apps/web/lib/legal.ts`.
- **Production database:** a separate Neon database (created by the user from the Vercel
  Marketplace), connected to the project's Production environment; `sh-staging` stays for Preview.
- **Private log lines go behind hold-to-reveal**, like the role card (decided during M6 build).
- **Web Push is a follow-up**, not in M6 (design in § M6 backlog). Turn alerts are a tab-title
  prefix plus vibration.

### Defaults chosen in this plan (change during review if needed)
- **Email verification via Resend** in M4, so bans can't be dodged with throwaway sign-ups.
- **GitHub repo private until launch**, then made public (fits CC attribution).
- ~~Neutral domain name~~: no domain (M6 decision above). "Secret Hitler" stays the game title in the UI. The vercel.app address contains "hitler", which some social platforms filter: a neutral free `*.vercel.app` alias is the cheap fix if shared links get blocked.

---

## Architecture

```
Browser (Next.js client components)
  │ HTTPS same-origin (Auth.js cookie or guest cookie)
  ▼
apps/web — Next.js 16 on Vercel ── Prisma 7 ──► Neon Postgres
  • pages, Auth.js, profiles, admin, rules, credits
  • POST /api/rooms/[code]/ticket → EdDSA JWT (60 s, single-use)
  • createRoom server action → HMAC → rooms /internal/rooms
  • POST /api/internal/{games,reports} (HMAC, idempotent) ◄── DO outbox (alarm retries)
  │
  │ WSS wss://<worker>.workers.dev/v1/rooms/:code/ws?t=<ticket>  (Origin allow-list; no custom domain)
  ▼
apps/rooms — Cloudflare Worker (verifies ticket / HMAC / Origin)
  ├── GameRoom DO: one per room code, SQLite storage, locationHint "weur"
  │     pure room reducer + GameModule adapter → packages/engine (pure)
  └── Lobby DO (singleton): public room list over WS, quick match
```

Ground rules:
1. The engine is pure: no I/O, no clock, no `Math.random` (seeded RNG in state).
2. Only the DO holds the full game state. Clients only ever receive `viewFor(state, viewer)` projections.
3. Prisma lives only in `apps/web`; the Worker never touches Postgres. It posts results to the web API.
4. Tickets are signed by web with an Ed25519 private key and verified by the Worker with a public JWKS (the Worker can't mint tickets). Server-to-server calls use HMAC, one secret per direction.

**Transport choice:** raw Durable Object WebSocket Hibernation API (not `partyserver` 0.5.x: every message is a per-player projection so its broadcast/routing is unused, and its 2 KB connection state is too small). Client uses `partysocket` (reconnecting, `url: async () => freshTicketUrl()`, `maxEnqueuedMessages: 0`). Compatibility date ≥ 2026-04-07.

---

## Repo layout (npm workspaces, TS-source internal packages, no build step)

```
secret-hitler/
  package.json (workspaces packages/*, apps/*)  .nvmrc (24)  tsconfig.base.json  eslint.config.mjs
  LICENSE (CC BY-NC-SA 4.0)  CREDITS.md  THIRD_PARTY_NOTICES.md  README.md  CLAUDE.md
  docker-compose.yml  scripts/ci.sh  scripts/ci/*.sh  scripts/gen-ticket-keys.ts
  .github/workflows/{ci.yml, deploy-rooms.yml, codeql.yml}   docs/  .debug/README.md
  packages/engine/      @sh/engine   — rules, zero deps
  packages/protocol/    @sh/protocol — zod message schemas, ticket claims, internal payloads, HMAC, name filter
  apps/rooms/           @sh/rooms    — Worker: router, GameRoom DO, Lobby DO, GameModule adapter, dev bots
  apps/web/             @sh/web      — Next.js app (velo-atelier layout, no src/)
```

Key files:
- `packages/engine/src/{types,constants,rng,setup,apply,rotation,eligibility,deck,knowledge,view,events,legal,defaults,replay,migrate}.ts`, `phases/*.ts`, `scripts/simulate.ts`, `test/rules/*`, `test/property/*`
- `packages/protocol/src/{client-messages,server-messages,player-view,room-view,chat,ticket,internal,hmac,close-codes,version}.ts`, `moderation/names.ts`
- `apps/rooms/src/{index.ts, auth/*, room/GameRoom.ts, room/room-state.ts, room/connections.ts, room/scheduler.ts, room/timers.ts, room/chat.ts, room/outbox.ts, lobby/Lobby.ts, lobby/matchmaking.ts, games/types.ts, games/secret-hitler/adapter.ts}`, `scripts/{bots,dev-ticket}.ts`, `wrangler.jsonc`
- `apps/web/app/[locale]/{jouer, salle/[code], regles, credits, conduite, (auth), (protected)/profil, (admin)/admin}/…`, `app/api/rooms/[code]/ticket/route.ts`, `app/api/internal/{games,reports}/route.ts`, `lib/rooms/ticket.ts`, `lib/guest/cookie.ts`, `lib/room-client/*`, `components/{game,room,lobby,admin}/*`, `messages/{fr,en}/*.json`, `prisma/schema.prisma`

Monorepo gotchas: `transpilePackages: ["@sh/engine","@sh/protocol"]`; `turbopack.root` and `outputFileTracingRoot` point at the **monorepo root** (not `process.cwd()` as in velo); Vercel root directory `apps/web`.

### Reuse from velo-atelier (`/Users/alienard/Code/velo-atelier/`)

| Concern | Copy / adapt |
|---|---|
| Auth.js v5 | `auth.ts`, `auth.config.ts`, `proxy.ts`, `types/next-auth.d.ts`, `lib/auth/*` (add `role`, `displayName` to JWT; keep `sessionVersion` re-check) |
| Prisma 7 | `prisma.config.ts`, `lib/db/*`, User/Account/Session/VerificationToken blocks of `prisma/schema.prisma`, citext migration, `docker-compose.yml`, `docker/initdb/01-test-db.sh` |
| next-intl | `lib/i18n/*` (`localePrefix: 'always'`, FR internal path keys), message-parity tests |
| Security | `lib/security/{origin,ip,rate-limit,csp}.ts`, `lib/env.ts`, `instrumentation.ts`, `lib/actions/*` |
| Styling | `styles/globals.css` token structure, contrast test |
| Tests | `vitest.config.ts`, `tests/setup*.ts`, `tests/_fakes/*`, `playwright.config.ts`, `tests/e2e/_fixtures.ts` (`signedInContext`, `forEachLocale`) |
| CI / deploy | `.github/workflows/ci.yml`, `scripts/ci.sh`, `scripts/ci/_lib.sh`, husky, gitleaks, renovate, `vercel.json`, `scripts/vercel-build.sh` |
| Process | `.debug/` notes, `CLAUDE.md` with nvm preamble, wave/task format with one sub-agent per task |

Versions checked 2026-11-01: next 16.4.3, next-auth 5.0.0-beta.32, prisma 7.10.1 (avoid 8 rc), zod 4.6.7, vitest 4.1.x, @playwright/test 1.64.1, jose 6.2.15, wrangler 4.156.0, fast-check 4.10.2, next-intl 4.14.9, @cloudflare/vitest-plugin 1.4.11 (replaces vitest-pool-workers).

---

## Rules engine (`packages/engine`)

API: `setup(n, seed)`, `apply(state, {seat, action}) → {ok, state, events} | {ok:false, error}`, `legalActions`, `pendingActors`, `defaultAction(state, seat, rand)` (rooms passes its own RNG), `viewFor(state, seat | 'spectator')`, `outcome`, `replay(seed, n, actions)`, `migrate(raw)`.
Actions: `nominate, vote, presidentDiscard, chancellorEnact, proposeVeto, respondVeto, investigate, acknowledgePeek, specialElection, execute`.

Rules, checked against the official PDF (corrections from the first draft in **bold**):
- Roles: 5→3L/1F, 6→4L/1F, 7→4L/2F, 8→5L/2F, 9→5L/3F, 10→6L/3F, + Hitler. Deck 6L/11F.
- Knowledge: fascists see all fascists + Hitler; Hitler sees fascists only in 5–6 player games.
- Powers by board (index = fascist policy number): 5–6 `[–, –, peek, execute, execute]`; 7–8 `[–, investigate, specialElection, execute, execute]`; 9–10 `[investigate, investigate, specialElection, execute, execute]`. 6th F = fascist win. Veto unlocked after 5th F, however enacted.
- Chancellor eligibility: alive, not president, not last elected chancellor, and not last elected president **unless ≤ 5 players are alive**.
- Vote passes iff Ja > alive/2 (tie fails). Ballots revealed only when all are in. If F ≥ 3 and the elected chancellor is Hitler → fascists win; otherwise he's publicly confirmed not-Hitler.
- **Election tracker resets only when a policy is enacted**, not on a successful election. An agreed veto moves it +1 (can cause chaos).
- Chaos (3 failures): top policy enacted, **no power, no Hitler check**, term limits cleared, tracker reset. It can win the game and can unlock veto.
- **Reshuffle**: remaining draw pile shuffled together with discards when < 3 cards, checked at the end of each legislative session (before the power, so a peek sees the new deck) and after chaos.
- Veto: chancellor may propose once per session; if the president refuses, the chancellor must enact.
- Investigation shows party (Hitler = Fascist); nobody investigated twice. Special election: any other living player, even term-limited; rotation then resumes left of the caller (works even if the caller dies meanwhile). Execution doesn't reveal the party unless it's Hitler (liberals win).
- Wins: 5L or Hitler executed → liberals; 6F or Hitler elected chancellor after 3F → fascists.

**Hidden information rules**
- `viewFor` returns a branded type; `apps/rooms/src/room/connections.ts` is the only module allowed to call `ws.send`, and only with branded views (ESLint bans `.send(` elsewhere). Outgoing messages are validated against `.strict()` zod schemas in dev and tests.
- Never sent: deck order, others' roles (except per knowledge rules), the president's discard, the hand to anyone but its holder, the seed (stored only after the game). No state, hands or chat in logs.
- Property tests (fast-check, 1,000 runs per PR, 20,000 nightly) playing random legal games: 17 cards conserved, deck ≥ 3 at each draw, tracker in range, exactly the right actors, termination, replay determinism, every view passes the strict schema, **non-interference** (shuffling hidden deck order or swapping roles a viewer can't know leaves that viewer's view byte-identical), state < 100 KB.

---

## Rooms Worker (`apps/rooms`)

**Router:** validates room code, checks `Origin`, verifies the ticket (EdDSA, `iss sh-web`, `aud sh-rooms`, `room === code`, 60 s), then forwards to the room DO. `/internal/*` endpoints require HMAC with a ±300 s window. Room codes: 5 letters from a vowel-free alphabet (no accidental words).

**GameRoom DO:** message path = parse → authorize (seat from socket attachment) → reducer / `GameModule.apply` → `storage.put` (one row per action) → send each socket its own projection. Never `await fetch` in the message path; external calls go through an outbox drained by the DO alarm. One alarm multiplexes phase deadlines, reconnection grace, start countdown, outbox retries, lobby heartbeat and purge.

Lifecycle: lobby (max 10 seats + 20 spectators, host = creator) → start (≥ 5 seated, seats shuffled, `engine.setup`) → playing → ended (all roles revealed) → rematch (same code) → purge 30 min after end, once the outbox is empty. Late joiners spectate; kicked identities are refused for the room's life; several tabs can share a seat.

**Reconnection and AFK defaults**
- Every (re)connect gets a full snapshot, so games survive deploys and DO eviction.
- Private rooms: timers off by default (host can pick relaxed / standard / fast); disconnected seats held indefinitely; host can force a default action for a seat disconnected ≥ 60 s, or end the game.
- Public rooms: standard timers — nominate 60 s (random eligible), vote 45 s (**Nein**), discard/enact 45 s (random, no veto), veto response 30 s (refuse), investigate / special election 60 s, execute 90 s (random legal target), peek 20 s. 90 s reconnection grace, then marked AFK and auto-played. Game ends as **abandoned** (no winner) if fewer than half the living players are connected for 3 min. 2 abandons in 24 h → 15 min quick-match cooldown.
- Public start: no ready button; 30 s countdown once ≥ min players (host-set 5–10, default 7) are connected; 5 s at 10 players.

**Lobby DO:** registry of public rooms (lang, seats, timers), pushed to viewers over a hibernatable WebSocket (throttled 1/s; polling would burn the free request quota). Quick match: open public room in the user's language with free seats and no blocked users, most-filled first, else create one.

**Free-tier budget:** ~450–600 DO rows written per 10-player game → ~200 games/day on the free plan (rows written is the first limit). Upgrade path: Workers Paid $5/month.

**GameModule seam** (`src/games/types.ts`): `setup, apply, view, pendingActors, defaultAction, phaseKey, chatPolicy, outcome` + min/max players + action schema. Rooms, lobby and chat only talk to the game through it.

---

## Identity, chat, persistence, moderation

**Identity**
- Accounts: Auth.js v5 (Credentials + Google, JWT sessions) from velo, plus Resend email verification. Onboarding sets a unique display name (citext) and a "15 or older" confirmation. Google names never shown.
- Guests: `sh_guest` httpOnly cookie (signed JWT `{gid, name}`, 30 days); private rooms only.
- Ticket route checks session/guest, bans, display name, rate limit (60/min), then signs `{kind, name, room, blocks, mod, protocolVersion}` with a `jti` the DO accepts once. Public rooms refuse guests (close 4403 `account_required` → sign-in prompt).
- Short invite link `/r/CODE` redirected to the locale route by `proxy.ts`.

**Chat** (in the DO, last 300 messages)
- 300 chars, normalised, rate-limited (burst 3, 5 per 10 s; public slow mode 2 s), flood → close 4429.
- Who can post: everyone in lobby and after the game; during play **living players only**; **president and chancellor silenced during the legislative session**. Rules come from `GameModule.chatPolicy`.
- Slur list (FR+EN) rejects messages. System messages are i18n keys rendered in each viewer's language.
- Mute = client-side; block = stored in Postgres, carried in the ticket, filtered per recipient by the DO, avoided by quick match.
- Report: the DO builds the evidence snapshot itself (last 100 messages, public event log, identities) and sends it via the outbox. Chat is otherwise never stored in Postgres.

**Persistence** (Prisma, `apps/web/prisma/schema.prisma`)
- velo auth models + `User.displayName`, `role (USER|MODERATOR|ADMIN)`, `ageConfirmedAt`; `RateLimit`; `Block`; `Ban`; `Report`; `ModerationAction`; `Game`; `GamePlayer`; `GameLog` (one compressed JSONB row per game with seed/actions/events — keeps Neon's 0.5 GB free tier viable).
- Game end: DO writes an outbox entry → alarm POSTs `GameResultPayload` (HMAC) → idempotent upsert by `gameId`; backoff up to 3 days.
- Account deletion: blocks and bans cascade; game history kept as "Deleted player".

**Moderation**
- Admin pages: report queue + detail (transcript from snapshot), ban (duration or permanent), force rename, dismiss, notes; every action logged. Bootstrap admin with `npm -w @sh/web run admin:grant -- <email>`.
- Display names: 2–20 chars, filtered (`obscenity` + French list + reserved names), one rename per 30 days.
- Rate limits: room creation 10/h, reports 10/h, guest cookies 20/h per IP.
- Legal pages: mentions légales, privacy, code of conduct (`/conduite`), contact email for DSA reports.

---

## Frontend (`apps/web`)

- Routes (FR / EN): `/` · `/jouer` `/play` · `/salle/[code]` `/room/[code]` · `/regles` `/rules` · `/credits` · `/conduite` `/conduct` · sign-in/up · `/profil` `/profile` (+ name onboarding) · `/admin/signalements` `/admin/reports` · `/admin/bannis` `/admin/bans` · legal pages · `/dev/table` (fixture-driven, test only) · `/r/[code]`.
- Room client: `partysocket` → zustand vanilla store → `useRoom(selector)`; server clock offset; connection banner; no optimistic updates (`seq` guards double actions).
- Game components: table and player circle (list on narrow phones), seat badges (placards, voted, not-Hitler, investigated, dead, AFK), liberal/fascist tracks with board-specific powers, election tracker, piles, nomination picker, Ja!/Nein! vote, policy hand, veto prompt, power panel, investigation/peek reveals, role reveal (press-and-hold privacy mode), phase banner + timer, game-over reveal, event log, chat sheet, report dialog. Lobby: public list, quick match, join by code, invite link + QR.
- Mobile-first; accessibility: no colour-only meaning, `aria-live` announcements, focus moves to your action, keyboard operable, reduced motion, axe tests per phase.
- Fonts: OFL substitutes (Germania One, UnifrakturMaguntia, Jost) via `next/font`. CSP `connect-src` lists the rooms host.
- Rules page: our own FR/EN text + link to the official PDF. Credits page: official credit line, GW&C ©, license link, asset sources, "What we changed", not-affiliated disclaimer, source link, no-money statement.
- M6 (built): `/regles` `/rules` (rules + FAQ), `/credits` (`#what-we-changed` mirrors `CREDITS.md`, checked by `tests/unit/credits-sync.test.ts`), `/mentions-legales` `/legal-notice`, `/confidentialite` `/privacy` (publisher, hosts, `SOURCE_CODE_URL` in `lib/legal.ts`), a footer on every page (`components/site/SiteFooter.tsx`, from the layout), a localized 404 (`app/[locale]/not-found.tsx` + `[...rest]`).
- M6 (built) game table: investigation result panel (behind hold-to-reveal), private log lines behind hold-to-reveal (`components/game/hold.ts`), vote warnings (Hitler zone, tracker at 2), staged ballot reveal + "Ja 4 – Nein 3" strip, CSS reveal animations (`motion.ts`, reduced motion respected), team/policy counters, role tips, "waiting for" markers on every awaited seat (`waitingSeats` = engine `pendingActors`), unique initials per table (`initials.ts`), turn alerts (tab-title prefix + vibration, `lib/turn-alert/`).
- Art: every drawing is our own SVG in code (not adapted from the print & play); fonts are Germania One and Jost (OFL) via `next/font`.

---

## Milestones (each ends playable or testable; ∥ = parallel)

| # | Scope | Done when |
|---|---|---|
| **M0** Scaffold | Workspaces, tooling, CI skeleton (velo `ci.sh`), LICENSE/CREDITS stubs, `CLAUDE.md`, private repo `lienardale/secret-hitler`; ∥ empty engine/protocol, "hello DO" + one worker test, web shell copied from velo | `npm ci && bash scripts/ci.sh` green; rooms `/health` 200 |
| **M1** Engine | Types/constants/rng/deck/setup/knowledge → `apply` (all phases) → `viewFor`/events/legal/default/replay → rule scenario tests, property tests, `simulate` CLI, protocol fixtures. ∥ assets prep, ∥ Prisma + Auth.js | engine coverage 100% lines; `simulate --games 20000` → 0 violations |
| **M2** Protocol + rooms + bots | Protocol schemas/HMAC/names; Worker router + auth; GameRoom (reducer, storage, scheduler, timers, grace, basic chat, outbox stub, purge); ∥ Lobby DO + matchmaking; ∥ dev ticket + WS bots; workerd tests (security, alarms, eviction resume, outbox retry) | `wrangler dev` + `bots --players 7 --timers fast` finishes a game; a killed bot rejoins its seat |
| **M3** Private games with guests | Web foundations; guest cookie, create room, ticket route, `/r/[code]`; ∥ room client; ∥ game components on `/dev/table`; room screens, role reveal, end + rematch, basic chat; ∥ SVG assets; e2e (5 guest browsers; 1 browser + 6 bots); staging deploy | 5 phones finish a game from a shared link on staging; e2e green in CI |
| **M4** Accounts + public play | Prisma schema/migration/seed; ∥ Auth.js + Resend verification, onboarding, profile (blocks, history, delete); ∥ `/api/internal/games` + real outbox; ∥ public mode (lobby UI, quick match, start rule, AFK/abandon, cooldown) | a public game by 5 accounts on staging shows in each profile history |
| **M5** Chat + moderation | ∥ chat rules, mute/block, system messages; ∥ report flow; ∥ admin queue, bans, rename, Worker kick/close; ∥ name filter, rate limits, conduct page. Added during M5: peek keeps pile order, no host kick in a running public game (kicks never count as abandons), abandoned games reveal roles, cooldown at the ticket route, installable PWA + screen wake lock | e2e: report → admin → ban → banned user's ticket refused |
| **M6** Polish + launch | Phase 1 (built): rules/credits/legal pages FR/EN, the M6 backlog below, turn alerts, axe + keyboard sweep. Phase 2: production on the existing Vercel project (no domain), Neon prod database, usage alerts, uptime check, runbook. Phase 3: friends beta → tune AFK → make repo public → launch | production game played by friends; checks below pass |

### M6 backlog (from comparing with secret-hitler.online, 2026-11-02)

From a comparison with ShrimpCryptid/Secret-Hitler-Online. **Status after M6 phase 1:** every item
below is built except Web Push, `launch_handler` and the uptime check (phase 2).

- An investigation result panel for the President (today only a private log line, easy to miss).
- Warnings in the vote and nomination panels: "If Hitler is elected now, the fascists win" once
  3+ fascist policies are down; "If this vote fails, the top policy is played" with the tracker at 2.
- A staged vote reveal (per-seat delay, reduced motion respected) and a "Ja 4 – Nein 3 · rejected"
  strip in the phase banner.
- Non-blocking reveal animations for enacted policies, the tracker moving and executions.
- Counters: team composition ("4 Liberals / 1 Fascist / Hitler") and policies still in play
  ("6 L, 11 F" minus enacted).
- Role tips and win conditions at game start (pulse the role card until first revealed), "you can
  lie" on investigate, "don't reveal your role" for executed players.
- A "waiting for…" marker on every seat the game waits on, in every phase (today only votes).
- A FAQ on the rules page: Hitler knows the fascists only at 5–6 players (say it on the role
  reveal too); votes are public by design; veto then chaos draws from the reshuffled pile.
- Decide whether the private event-log lines (drawn hand, peek, investigation result:
  `components/game/log-text.ts`, `EventLog.tsx`) go behind the same hold-to-reveal as the role card.
  **Decided: yes.** Their text (and an investigation's colour) is not in the DOM until held; the
  live decision (hand, peek) stays visible while you act on it.
- A tab-title prefix plus vibration when a decision starts (**built**), push notifications, and
  `launch_handler` / link capturing for the installed app (the manifest, icons, offline page and
  screen wake lock shipped in M5).
- **Web Push (follow-up, not built).** One VAPID P-256 pair per environment (`dev:setup`; public
  key `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private JWK = Worker secret `VAPID_PRIVATE_JWK`; subject
  `mailto:` + `CONTACT_EMAIL`). Payload-less push (empty body, `TTL: 60`, `Urgency: high`): no
  RFC 8291 encryption, the Worker only signs an ES256 VAPID JWT. `sw.js` shows a generic "your
  turn" notification (one tag) and focuses or opens the room. Subscribe only from a button; an
  additive client message `{t:"push", endpoint|null}` (deploy the Worker first) stores one row per
  player in the DO's SQLite (https endpoints of known push services only; deleted on leave, kick,
  purge, `null`, or a 404/410). Sending never in the message path: when a decision starts for a
  player with no visible connected socket (additive `{t:"presence", visible}`), the room marks a
  push due in ~10 s and the alarm sends it through the outbox (kind `push`, give up after ~2 min),
  at most once per decision and per 30 s. iOS: only in the installed PWA (16.4+).
- Auto-assigned initials next to each name, so players can tell 10 seats apart.
- An external uptime check in the runbook.

Found while writing the privacy page (M6), fixed: Google sign-in stored Google's OAuth tokens
(the id_token carries the name and picture) — `lib/auth/minimal-accounts.ts` now keeps only the
provider id; rooms were created without the `weur` location hint — every `getByName` now passes
`PLACEMENT` (`apps/rooms/src/placement.ts`). Open: retention limits (rate-limit rows, report
evidence, moderation log, game logs, room visits, expired e-mail tokens are kept with no time
limit; the privacy page says so), and a deleted-then-recreated account escapes its ban.

Decided not to adopt: bots in public play (maybe a solo practice mode one day), portrait avatars
(licence unclear), secret votes, a private fascist chat, expansions.

Execution: one sub-agent per task in a git worktree, velo-style (file ownership per task, integration step per milestone). Node commands need `source "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null &&`. Docker is usually stopped: check `docker info` first.

---

## Verification

- **Engine:** `npm -w @sh/engine run test -- --coverage` (rule scenarios + property tests incl. non-interference); `npm -w @sh/engine run simulate -- --games 20000`.
- **Protocol:** schema round-trips; every engine view passes the strict schema; HMAC test vectors identical in Node and workerd.
- **Rooms:** `npm -w @sh/rooms test` with `@cloudflare/vitest-plugin` (`--max-workers=1 --no-isolate` for WebSocket suites): forged/expired/replayed/wrong-room tickets, guest in public room, bad Origin/HMAC, actions from non-actors/spectators/dead players, chat silence rules, flood; alarms via `runDurableObjectAlarm`; hibernation/eviction resume via `evictDurableObject`; outbox retry with mocked fetch.
- **Web:** unit + jsdom component tests from engine fixtures; integration on real Postgres (result ingestion idempotency, ban refusal, rate limits, account-deletion anonymisation).
- **End to end (Playwright, prod build :3100 + `wrangler dev` :8787, test seed):** 5 guest browser contexts play a private game to the end; 7-player game with 1 browser + 6 bots; 5 signed-in accounts quick-match into a public game and the result lands in Postgres; report → ban → rejoin refused; FR and EN; mobile viewport. `a11y.spec.ts`: axe (WCAG 2.1 A/AA) on every page FR/EN, desktop and Pixel 7, dark scheme on desktop, signed-in / admin / room screens, every `/dev/table` fixture for a player and a spectator. `keyboard.spec.ts`: keyboard-only play, focus moves and live regions, turn alerts in a real room. `pages.spec.ts`: the content pages and footer links.
- **Manual on staging:** 5+ real phones from a shared link, kill Wi-Fi mid-game and reconnect, deploy the Worker during a game and confirm it resumes.

---

## Risks and open points

1. **Name in links:** "Hitler" in URLs/previews may be down-ranked by social filters. No domain (M6 decision): the vercel.app address contains it; a neutral `*.vercel.app` alias is free if links get filtered.
2. **CC BY-NC-SA on code** follows precedent but has no patent grant; NC applies to forks. Dependency notices in `THIRD_PARTY_NOTICES.md`. Not legal advice.
3. **Free tiers:** DO rows written (~200 games/day), Workers 100k requests/day, Neon 0.5 GB, Vercel Hobby (non-commercial OK). Paying hosting costs doesn't conflict with NC.
4. **AFK defaults** (Nein vote, random targets) affect balance; tune after the friends beta; a "remake" vote may come in v1.1.
5. **Collusion/ghosting** in public games (Discord side channels) can't be stopped technically; reports + moderation only.
6. **Deploys drop sockets:** protocol changes stay additive (Worker accepts N−1); engine changes ship `migrate()` for in-flight games.
7. **GDPR/age:** 15+ confirmation, privacy page, essential cookies only, chat kept only for the room's life, deletion anonymises history.
