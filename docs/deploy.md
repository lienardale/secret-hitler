# Deploying

Two pieces, deployed separately:

| Piece                      | Where                                                                                                                          | Staging                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Website (`apps/web`)       | Vercel, project `secret-hitler-staging` (team `lienardales-projects`), root directory `apps/web`, Node 24, functions in `cdg1` | https://secret-hitler-staging.vercel.app      |
| Game server (`apps/rooms`) | Cloudflare Workers + Durable Objects, `wrangler.jsonc` env `staging` → Worker `sh-rooms-staging`                               | https://sh-rooms-staging.sh-rooms.workers.dev |
| Database                   | Neon Postgres (free plan, `fra1`), resource `sh-staging` added from the Vercel Marketplace and connected to the Vercel project | (no public URL)                               |

**Production (M6 decision, 2026-11-02):** there is no domain and no separate project. The site is
mostly for the operator's friends, so this project _is_ production: its Production environment
gets its own Neon database (created by the operator from the Vercel Marketplace and connected to
Production only), while `sh-staging` stays connected to Preview. The Worker stays
`sh-rooms-staging` on `workers.dev`. No Resend: no e-mail is sent and `REQUIRE_EMAIL_VERIFICATION`
stays off. The production runbook (usage alerts, uptime check, first deploy on the new database)
is added in M6 phase 2.

When a host, a region or a hosting company changes, update `HOSTS` in `apps/web/lib/legal.ts`,
the `privacy.hosting.*` lines in `messages/*/legal.json` and `LEGAL_UPDATED`.

Access: the stable address `secret-hitler-staging.vercel.app` is public (anyone with the link can
play); per-deployment URLs (`secret-hitler-staging-<hash>-lienardales-projects.vercel.app`) stay
behind Vercel Authentication. The `/dev/*` test pages answer 404 there (`ENABLE_TEST_PAGES` unset).
`.vercelignore` keeps local secrets (`.env*`, `.dev.vars`) out of CLI uploads.

## Secrets

Generated once per environment, never committed, never printed:

| Name                  | Website (Vercel)         | Game server (Wrangler) |
| --------------------- | ------------------------ | ---------------------- |
| `TICKET_PRIVATE_JWK`  | yes (signs room tickets) | no                     |
| `TICKET_PUBLIC_JWK`   | no                       | yes (checks tickets)   |
| `WEB_TO_ROOMS_SECRET` | yes                      | yes                    |
| `ROOMS_TO_WEB_SECRET` | yes                      | yes                    |
| `GUEST_SECRET`        | yes                      | no                     |
| `AUTH_SECRET`         | yes (session cookies)    | no                     |

The database variables (`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `DATABASE_URL`…) are
injected by the Neon integration; nothing to copy by hand. The website reads `POSTGRES_URL`
(pooled) at run time and migrations use `POSTGRES_URL_NON_POOLING` (direct).

`npm run dev:setup -- --print` prints a fresh set. Write each value to its own file (mode 600)
and pipe it, so it never lands in shell history or logs:

```bash
vercel env add GUEST_SECRET production --sensitive < GUEST_SECRET          # from the repo root (linked)
npx wrangler secret put TICKET_PUBLIC_JWK --env staging < TICKET_PUBLIC_JWK  # from apps/rooms
```

Rotating the ticket key pair or an HMAC secret means updating both sides, then redeploying both.

## Database migrations

The Vercel project's build command is `npm run vercel-build` (`apps/web/scripts/vercel-build.sh`):
on the project's **production** target it runs `prisma migrate deploy`, then `next build`.
Preview builds never migrate (they share the same database). A migration that fails stops the
deploy before the build, and the previous deployment keeps serving.

## Accounts: e-mail and Google

- **E-mail verification** is built and tested (`MAIL_TRANSPORT=log`, the default, writes mails to
  the server log instead of sending them). Staging has no domain yet, so `REQUIRE_EMAIL_VERIFICATION`
  is **not** set there: public play does not wait for a verified address. To turn real mail on
  (M6, once the domain exists): verify the domain on Resend, then set `MAIL_TRANSPORT=resend`,
  `RESEND_API_KEY` (sensitive), `MAIL_FROM` (`Secret Hitler <noreply@<domain>>`) and
  `REQUIRE_EMAIL_VERIFICATION=1`, and redeploy.
- **Google sign-in** turns on when both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set (the
  button appears by itself). In Google Cloud Console: OAuth client of type "Web application",
  authorised redirect URI `https://<site>/api/auth/callback/google`
  (`https://secret-hitler-staging.vercel.app/api/auth/callback/google` for staging). Google's name
  and picture are never stored; new Google accounts choose a player name on `/bienvenue`.
- Admins: `npm -w @sh/web run admin:grant -- <email>` (role `ADMIN`; `--role MODERATOR` also works),
  with `POSTGRES_URL_NON_POOLING` exported for the target database (for staging, pull it from
  Vercel into a mode-600 file: `vercel env pull <file> --environment=production`, export, run,
  delete the file). Moderators see a "Modération" link in the header: `/admin/signalements` (report
  queue and detail) and `/admin/bannis` (bans). Every action is logged in `ModerationAction`.

## Order of a first deploy

1. **Game server**: `npm -w @sh/rooms run deploy:staging`, then the three Wrangler secrets.
   Note the `workers.dev` URL it prints.
2. **Website env**: `ROOMS_URL` = that URL (plain, production target). The CSP's
   `connect-src` is computed from it **at build time**, so set it before building.
3. **Website**: from the repo root, `vercel deploy --prod`.
4. **Allowed origin**: `ALLOWED_ORIGINS` in `wrangler.jsonc` (env `staging`) must be the site's
   exact origin; redeploy the game server if it changed.
5. **Game results**: `WEB_API_URL` in `wrangler.jsonc` (env `staging`) is the website's origin;
   rooms post finished games to `/api/internal/games` (HMAC with `ROOMS_TO_WEB_SECRET`) and retry
   for 3 days, so either side may be deployed first.

## Checks after a deploy

- `curl https://sh-rooms-staging.sh-rooms.workers.dev/health` → `{"ok":true,"protocol":1}`.
- Five browsers play a whole game against the deployed site:
  `PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app npx -w @sh/web playwright test private-game.spec.ts -g "five guests" --project=desktop-chromium`
  (and `home.spec.ts -g "home \(|invite link"` for the entry pages).
- Five accounts sign up, quick-match, play a public game and find it in their profiles (then
  the test accounts are deleted; sign-ups are limited to 5 per hour per address):
  `PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app npx -w @sh/web playwright test staging-public-game.spec.ts --project=desktop-chromium`
- Moderation (M5): two accounts signed up through the form share a room, one reports the other,
  an admin bans them from the report; the banned player's socket closes and their next ticket is
  refused (the test accounts are then deleted). Needs an ADMIN account on staging, its address and
  password in `STAGING_ADMIN_EMAIL` / `STAGING_ADMIN_PASSWORD` or in
  `apps/web/.env.staging-e2e.local` (gitignored, mode 600):
  `PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app npx -w @sh/web playwright test staging-moderation.spec.ts --project=desktop-chromium`
- Content pages (M6): `PLAYWRIGHT_BASE_URL=… npx -w @sh/web playwright test pages.spec.ts --project=desktop-chromium --project=mobile-chromium`
  (rules, credits, legal notice, privacy in FR and EN, footer links, no console errors).
- Installable app: `PLAYWRIGHT_BASE_URL=… npx -w @sh/web playwright test pwa.spec.ts --project=desktop-chromium`
  (manifest, icons, service worker, offline page, no CSP errors). A real install on a phone
  (Android "Install app", iOS "Add to Home Screen") is checked by hand.
- Rate limits hold across serverless instances (Postgres) and, behind Vercel, every test browser
  shares the runner's address: room creation is limited to 10 per hour per address (`home.spec.ts`
  creates 8 per run) and sign-ups to 5. Run the staging specs about once an hour.
- `npx wrangler tail sh-rooms-staging` shows the Worker's logs (no state, hands or chat are logged).

The first deploy registered the account's `workers.dev` subdomain as `sh-rooms` (changeable in the
Cloudflare dashboard; the Worker URL and the website's `ROOMS_URL` would change with it).

## Free-tier budget

Workers Free: 100k requests/day and ~100k Durable Object rows written/day (the first limit: a
10-player game writes a few hundred rows). Vercel Hobby is fine for a non-commercial site.
