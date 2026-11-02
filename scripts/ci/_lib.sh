#!/usr/bin/env bash
# Shared helpers for scripts/ci/* — sourced first by every step script.
#
# Adapted from velo-atelier. The nvm line makes a step behave the same in a
# terminal, in a non-login shell (Claude Code: ~/.zshrc is not read, so no
# node on PATH) and on GitHub Actions (node from setup-node, no nvm). It is
# skipped when Node 24 is already on PATH, which also avoids nvm refusing to
# run beside npm's `npm_config_prefix` under `npm run`.
node_major="$(command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ "$node_major" != "24" ]; then
  # shellcheck disable=SC1091
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" --no-use && nvm use --silent 24
fi
unset node_major

set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
export PROJECT_ROOT

if [[ -t 1 ]]; then
  C_RESET="\033[0m" C_BOLD="\033[1m" C_BLUE="\033[34m" C_GREEN="\033[32m" C_RED="\033[31m" C_YELLOW="\033[33m"
else
  C_RESET="" C_BOLD="" C_BLUE="" C_GREEN="" C_RED="" C_YELLOW=""
fi
export C_RESET C_BOLD C_BLUE C_GREEN C_RED C_YELLOW

log_step() { printf "${C_BOLD}${C_BLUE}::%s${C_RESET}\n" " $*"; }
log_ok() { printf "${C_GREEN}::%s${C_RESET}\n" " $*"; }
log_err() { printf "${C_RED}::%s${C_RESET}\n" " $*" >&2; }
log_warn() { printf "${C_YELLOW}:: WARNING%s${C_RESET}\n" " $*" >&2; }

# skip_step <reason...>
# A step whose target does not exist yet must be loud and harmless: it warns,
# records SKIP (never PASS, which would hide a gate that is not running) and
# exits 0. scripts/ci.sh passes CI_STEP_STATUS_FILE to tell SKIP from PASS.
skip_step() {
  log_warn "SKIP — $*"
  if [[ -n "${CI_STEP_STATUS_FILE:-}" ]]; then
    printf "SKIP\n" >"$CI_STEP_STATUS_FILE"
  fi
  exit 0
}

# workspace_has_tests <dir>: true when the workspace has at least one test file.
workspace_has_tests() {
  [[ -n "$(find "$PROJECT_ROOT/$1" -path '*/node_modules' -prune -o -name '*.test.ts' -print -quit 2>/dev/null)" ]]
}
