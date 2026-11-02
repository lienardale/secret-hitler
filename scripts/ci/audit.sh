#!/usr/bin/env bash
# Dependency audit: fail on high or critical advisories in production deps.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "npm audit (prod, high+)"
npm audit --omit=dev --audit-level=high
log_ok "audit passed"
