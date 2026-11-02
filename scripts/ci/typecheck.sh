#!/usr/bin/env bash
# tsc --noEmit in every workspace.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

log_step "typecheck (all workspaces)"
npm run typecheck --workspaces --if-present
log_ok "typecheck passed"
