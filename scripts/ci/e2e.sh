#!/usr/bin/env bash
# Playwright end-to-end tests: local keys, a production build of the website,
# then real browsers against `next start` and `wrangler dev` (started by the
# Playwright config). Not part of `ci.sh` by default (RUN_E2E=1 adds it).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "e2e: local keys and secrets"
npm run dev:setup

ensure_test_database

log_step "e2e: next build (web)"
npm -w @sh/web run build

if [[ -n "${CI:-}" ]]; then
  log_step "e2e: install Chromium"
  npx -w @sh/web playwright install --with-deps chromium
fi

log_step "e2e: playwright"
npm -w @sh/web run e2e
log_ok "e2e passed"
