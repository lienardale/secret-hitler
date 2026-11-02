#!/usr/bin/env bash
# Tests for apps/web (with its own coverage thresholds when configured).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

workspace_has_tests "apps/web" || skip_step "apps/web has no tests yet"
log_step "test apps/web"
npm -w "apps/web" run test:ci
log_ok "apps/web tests passed"
