# 010 — e2e on another website port: every room socket refused (403)

**Observed.** With `PLAYWRIGHT_PORT=3101` (to run beside another e2e run), every room spec failed:
the page never connected to its room. Specs that do not open a room passed.

**Cause.** The rooms Worker checks `Origin` against `ALLOWED_ORIGINS`, which `wrangler.jsonc`
sets to `http://localhost:3000,http://localhost:3100` for local runs. A website on :3101 sends
`Origin: http://localhost:3101`, so the upgrade answered 403 "Forbidden origin". The documented
alternate-port run had only ever moved the rooms port (`PLAYWRIGHT_ROOMS_PORT`), never the website.

**Fix.** `playwright.config.ts` starts the e2e Worker with
`--var ALLOWED_ORIGINS:http://localhost:3000,http://localhost:3100,http://localhost:<PLAYWRIGHT_PORT>`.
Keep :3000 in it: the bots script sends `Origin: http://localhost:3000`.

**Check.** Build with `ROOMS_URL=http://localhost:8789`, then
`PLAYWRIGHT_PORT=3101 PLAYWRIGHT_ROOMS_PORT=8789 npx -w @sh/web playwright test private-game.spec.ts`.
