#!/usr/bin/env bash
# Tests for apps/rooms (with its own coverage thresholds when configured).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

workspace_has_tests "apps/rooms" || skip_step "apps/rooms has no tests yet"
log_step "test apps/rooms"
npm -w "apps/rooms" run test:ci
log_ok "apps/rooms tests passed"
