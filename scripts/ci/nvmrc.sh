#!/usr/bin/env bash
# Node version consistency: .nvmrc, package.json engines.node and the running
# Node must agree on the major version.
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

[[ -s .nvmrc ]] || { log_err ".nvmrc is missing or empty"; exit 1; }
nvmrc_major="$(tr -d ' \t\r\nv' <.nvmrc)"
nvmrc_major="${nvmrc_major%%.*}"
engines_major="$(node -p "String(require('./package.json').engines.node).match(/([0-9]+)/)[1]")"
running_major="$(node -p "process.versions.node.split('.')[0]")"

printf "  .nvmrc %s · engines.node %s · running %s\n" "$nvmrc_major" "$engines_major" "$(node -v)"
[[ "$nvmrc_major" == "$engines_major" ]] || { log_err ".nvmrc and engines.node disagree"; exit 1; }
[[ "$running_major" == "$nvmrc_major" ]] || { log_err "running Node is not $nvmrc_major — run 'nvm use'"; exit 1; }
log_ok "node ${nvmrc_major}.x everywhere"
