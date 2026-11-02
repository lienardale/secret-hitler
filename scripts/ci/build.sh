#!/usr/bin/env bash
# Production builds: Next.js web app and a dry-run bundle of the rooms Worker.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "next build (web)"
npm -w @sh/web run build

log_step "wrangler deploy --dry-run (rooms)"
npm -w @sh/rooms run build

log_ok "build passed"
