#!/usr/bin/env bash
# Shared demo helpers. Sourced by each demo step.
# -----------------------------------------------------------------------------

set -euo pipefail

# Colours
BOLD=$'\e[1m'; DIM=$'\e[2m'; RESET=$'\e[0m'
CYAN=$'\e[36m'; GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; MAGENTA=$'\e[35m'

# Show a command and run it.  Use ` bash -c ` so the printed form matches the
# executed form even with pipes and redirection.
run() {
  echo
  echo "${BOLD}${CYAN}\$ $*${RESET}"
  bash -c "$*"
}

step() {
  echo
  echo "${BOLD}${MAGENTA}### $* ###${RESET}"
}

say() {
  echo "${DIM}# $*${RESET}"
}

ok() {
  echo "${GREEN}✓ $*${RESET}"
}

fail() {
  echo "${RED}✗ $*${RESET}"
}

# Wait for user to press Enter so judges have time to read.  Disable with
# PEAR_DEMO_NONINTERACTIVE=1 for automated runs.
pause() {
  if [[ "${PEAR_DEMO_NONINTERACTIVE:-0}" == "1" ]]; then return; fi
  echo
  echo "${YELLOW}[press ENTER to continue]${RESET}"
  read -r _ || true
}

# Persist key/value pairs across steps via demo.env.  Each machine writes to
# its own local demo.env in the cwd where the scripts are run.
ENV_FILE="${PEAR_DEMO_ENV:-./pear-demo.env}"
save_env() {
  # save_env KEY VALUE
  local key="$1"; shift
  local value="$*"
  # Remove any existing entry for this key, then append.
  if [[ -f "$ENV_FILE" ]]; then
    grep -v "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp" || true
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  fi
  echo "${key}=${value}" >> "$ENV_FILE"
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
  fi
}

require_env() {
  # require_env KEY "human-readable error message"
  local key="$1"; shift
  if [[ -z "${!key:-}" ]]; then
    fail "$ENV_FILE does not contain $key"
    fail "$*"
    exit 1
  fi
}

# Prerequisites check: pear-git must be on PATH.
check_prereqs() {
  if ! command -v pear-git >/dev/null 2>&1; then
    fail "pear-git not found on PATH."
    fail "From the gittorrent repo root, run: npm link    (or: bash scripts/install.sh)"
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    fail "git not found on PATH."
    exit 1
  fi
}

# Some seeders need a moment to come up.  Sleep with a visible message.
wait_for_seed() {
  local secs="${1:-3}"
  say "Waiting ${secs}s for the background seeder to register..."
  sleep "$secs"
}
