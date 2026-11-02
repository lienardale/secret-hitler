#!/usr/bin/env bash
# ESLint (root config for packages + rooms, Next config for web) and Prettier.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "eslint (packages, rooms)"
npx --no-install eslint .

log_step "eslint (web)"
npm -w @sh/web run lint

log_step "prettier --check"
npx --no-install prettier --check .

log_ok "lint passed"
