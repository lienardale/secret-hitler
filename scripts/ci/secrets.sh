#!/usr/bin/env bash
# Secret scan with gitleaks. On a CI runner a pinned release is installed;
# locally the developer's own copy is used (brew install gitleaks).
GITLEAKS_VERSION="8.21.2"
source "$(dirname -- "${BASH_SOURCE[0]}")/_lib.sh"
cd "$PROJECT_ROOT"

if ! command -v gitleaks >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    arch="x64"
    [[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "arm64" ]] && arch="arm64"
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sh-ci-tools"
    mkdir -p "$dir"
    curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz" | tar -xz -C "$dir" gitleaks
    PATH="$dir:$PATH"
  else
    skip_step "gitleaks not installed (brew install gitleaks)"
  fi
fi

gitleaks version
log_step "gitleaks detect"
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  gitleaks detect --source . --config .gitleaks.toml --no-banner --redact
else
  gitleaks detect --source . --config .gitleaks.toml --no-banner --redact --no-git
fi
log_ok "no leaked secrets"
