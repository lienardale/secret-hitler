#!/usr/bin/env bash
# Tests for packages/engine (with its own coverage thresholds when configured).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

workspace_has_tests "packages/engine" || skip_step "packages/engine has no tests yet"
log_step "test packages/engine"
npm -w "packages/engine" run test:ci
log_ok "packages/engine tests passed"
