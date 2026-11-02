# Deploying

Two pieces, deployed separately:

| Piece                      | Where                                                                                                                          | Staging                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Website (`apps/web`)       | Vercel, project `secret-hitler-staging` (team `lienardales-projects`), root directory `apps/web`, Node 24, functions in `cdg1` | https://secret-hitler-staging.vercel.app      |
| Game server (`apps/rooms`) | Cloudflare Workers + Durable Objects, `wrangler.jsonc` env `staging` → Worker `sh-rooms-staging`                               | https://sh-rooms-staging.sh-rooms.workers.dev |

Production (M6) will be a separate Vercel project and a `production` Wrangler env, on a domain.

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

`npm run dev:setup -- --print` prints a fresh set. Write each value to its own file (mode 600)
and pipe it, so it never lands in shell history or logs:

```bash
vercel env add GUEST_SECRET production --sensitive < GUEST_SECRET          # from the repo root (linked)
npx wrangler secret put TICKET_PUBLIC_JWK --env staging < TICKET_PUBLIC_JWK  # from apps/rooms
```

Rotating the ticket key pair or an HMAC secret means updating both sides, then redeploying both.

## Order of a first deploy

1. **Game server**: `npm -w @sh/rooms run deploy:staging`, then the three Wrangler secrets.
   Note the `workers.dev` URL it prints.
2. **Website env**: `ROOMS_URL` = that URL (plain, production target). The CSP's
   `connect-src` is computed from it **at build time**, so set it before building.
3. **Website**: from the repo root, `vercel deploy --prod`.
4. **Allowed origin**: `ALLOWED_ORIGINS` in `wrangler.jsonc` (env `staging`) must be the site's
   exact origin; redeploy the game server if it changed.

## Checks after a deploy

- `curl https://sh-rooms-staging.sh-rooms.workers.dev/health` → `{"ok":true,"protocol":1}`.
- Five browsers play a whole game against the deployed site:
  `PLAYWRIGHT_BASE_URL=https://secret-hitler-staging.vercel.app npx -w @sh/web playwright test private-game.spec.ts -g "five guests" --project=desktop-chromium`
  (and `home.spec.ts -g "home \(|invite link"` for the entry pages).
- `npx wrangler tail sh-rooms-staging` shows the Worker's logs (no state, hands or chat are logged).

The first deploy registered the account's `workers.dev` subdomain as `sh-rooms` (changeable in the
Cloudflare dashboard; the Worker URL and the website's `ROOMS_URL` would change with it).

## Free-tier budget

Workers Free: 100k requests/day and ~100k Durable Object rows written/day (the first limit: a
10-player game writes a few hundred rows). Vercel Hobby is fine for a non-commercial site.
