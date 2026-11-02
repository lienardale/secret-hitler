#!/usr/bin/env bash
# Local mirror of the GitHub Actions pipeline (adapted from velo-atelier).
#
# It runs the exact scripts .github/workflows/ci.yml runs, so a green local run
# means a green pipeline. `.husky/pre-push` calls it with SKIP_BUILD=1.
#
# A step whose target does not exist yet reports SKIP (never PASS) and exit 0.
#
# Env knobs:
#   SKIP_BUILD=1     skip the Next.js build and the Worker dry-run bundle
#   SKIP_SECURITY=1  skip secrets/audit (offline; never before a push)
#   STEPS="lint …"   run only these steps, in this order
#   RUN_E2E=1        add the Playwright end-to-end step (builds the website, starts servers)
#
# Written for bash 3.2 (macOS system bash).
set -euo pipefail

# shellcheck source=scripts/ci/_lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/ci/_lib.sh"
cd "$PROJECT_ROOT"

ALL_STEPS="nvmrc lint typecheck test-engine test-protocol test-rooms test-web secrets audit build"
STEPS_TO_RUN="${STEPS:-$ALL_STEPS}"
[[ "${RUN_E2E:-0}" == "1" && -z "${STEPS:-}" ]] && STEPS_TO_RUN="$STEPS_TO_RUN e2e"

drop_step() {
  local drop="$1" kept="" s
  for s in $STEPS_TO_RUN; do
    [[ "$s" == "$drop" ]] && continue
    kept="$kept $s"
  done
  STEPS_TO_RUN="${kept# }"
}

[[ "${SKIP_BUILD:-0}" == "1" ]] && drop_step build
if [[ "${SKIP_SECURITY:-0}" == "1" ]]; then
  drop_step secrets
  drop_step audit
  log_warn "SKIP_SECURITY=1 — gitleaks/audit disabled. Do NOT push this way."
fi

names=()
statuses=()
times=()
recorded=0
record() {
  names[$recorded]="$1"
  statuses[$recorded]="$2"
  times[$recorded]="$3"
  recorded=$((recorded + 1))
}

overall_start=$(date +%s)
failed=0

for step in $STEPS_TO_RUN; do
  script="$PROJECT_ROOT/scripts/ci/${step}.sh"
  if [[ ! -f "$script" ]]; then
    log_err "step '$step' has no script: $script"
    record "$step" FAIL 0
    failed=1
    break
  fi

  status_file="$(mktemp "${TMPDIR:-/tmp}/sh-ci-step.XXXXXX")"
  printf "PASS\n" >"$status_file"
  start=$(date +%s)
  log_step "▶ $step"
  if CI_STEP_STATUS_FILE="$status_file" bash "$script"; then
    status="$(cat "$status_file")"
  else
    status="FAIL"
  fi
  end=$(date +%s)
  rm -f "$status_file"
  record "$step" "$status" "$((end - start))"

  if [[ "$status" == "FAIL" ]]; then
    failed=1
    break # fail fast: the first failure is the one worth reading
  fi
done

overall_end=$(date +%s)
printf "\n${C_BOLD}── summary ──${C_RESET}\n"
i=0
while [[ $i -lt $recorded ]]; do
  case "${statuses[$i]}" in
  PASS) printf "  ${C_GREEN}✓ PASS${C_RESET}  %-16s %ss\n" "${names[$i]}" "${times[$i]}" ;;
  SKIP) printf "  ${C_YELLOW}- SKIP${C_RESET}  %-16s %ss\n" "${names[$i]}" "${times[$i]}" ;;
  *) printf "  ${C_RED}✗ FAIL${C_RESET}  %-16s %ss\n" "${names[$i]}" "${times[$i]}" ;;
  esac
  i=$((i + 1))
done
printf "  total: %ss\n\n" "$((overall_end - overall_start))"

if [[ "$failed" == "1" ]]; then
  log_err "ci:local failed"
  exit 1
fi
log_ok "ci:local passed"
