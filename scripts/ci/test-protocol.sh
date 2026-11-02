#!/usr/bin/env bash
# Tests for packages/protocol (with its own coverage thresholds when configured).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

workspace_has_tests "packages/protocol" || skip_step "packages/protocol has no tests yet"
log_step "test packages/protocol"
npm -w "packages/protocol" run test:ci
log_ok "packages/protocol tests passed"
