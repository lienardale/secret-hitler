#!/usr/bin/env bash
# Tests for apps/web: unit, ui, and integration on a real Postgres `_test`
# database (required here: VITEST_REQUIRE_DB=1 makes a missing database fail).
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

workspace_has_tests "apps/web" || skip_step "apps/web has no tests yet"
ensure_test_database
log_step "test apps/web"
VITEST_REQUIRE_DB=1 npm -w "apps/web" run test:ci
log_ok "apps/web tests passed"
