#!/usr/bin/env bash
# Machine C (outsider) — step 1: clone the repo without any write/indexer
# access. Should succeed for git data but the secrets should remain opaque.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs

GITTORRENT_URL="${1:-${GITTORRENT_URL:-}}"
if [[ -z "$GITTORRENT_URL" ]]; then
  fail "Pass the gittorrent URL: ./demo/c1-clone.sh gittorrent://..."
  exit 1
fi

DEMO_DIR="${DEMO_DIR:-$HOME/gittorrent-demo-c}"
save_env GITTORRENT_URL "$GITTORRENT_URL"
save_env DEMO_DIR "$DEMO_DIR"

step "Machine C — Step 1: clone as an outsider"
run "rm -rf '$DEMO_DIR' && mkdir -p '$(dirname "$DEMO_DIR")'"
run "git clone '$GITTORRENT_URL' '$DEMO_DIR'"

pause

step "Source code is visible — gittorrent is not about hiding git data"
run "cd '$DEMO_DIR' && git log --oneline"
run "cd '$DEMO_DIR' && cat README.md"

pause

step "Secrets list is also visible (paths are public, contents are not)"
# NOTE: Machine C has no key envelope so the 'list' command fails gracefully.
set +e
run "cd '$DEMO_DIR' && gittorrent secrets list"
set -e

echo
echo "${BOLD}Next run:${RESET}  ./demo/c2-cannot-read-secret.sh"
ok "done"
