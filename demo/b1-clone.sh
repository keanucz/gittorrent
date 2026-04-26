#!/usr/bin/env bash
# Machine B — step 1: clone the repo Machine A created.
# Expects GITTORRENT_URL either in env or passed as $1.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs

GITTORRENT_URL="${1:-${GITTORRENT_URL:-}}"
if [[ -z "$GITTORRENT_URL" ]]; then
  fail "Pass the gittorrent URL, e.g.: GITTORRENT_URL=gittorrent://... ./demo/b1-clone.sh"
  exit 1
fi

DEMO_DIR="${DEMO_DIR:-$HOME/gittorrent-demo-b}"
save_env GITTORRENT_URL "$GITTORRENT_URL"
save_env DEMO_DIR "$DEMO_DIR"

step "Machine B — Step 1: clone $GITTORRENT_URL"
run "rm -rf '$DEMO_DIR' && mkdir -p '$(dirname "$DEMO_DIR")'"
run "git clone '$GITTORRENT_URL' '$DEMO_DIR'"

pause

step "Confirm the clone landed"
run "ls -la '$DEMO_DIR'"
run "cat '$DEMO_DIR/README.md'"

pause

step "Machine B's long-term public key"
B_PUBKEY=$(cd "$DEMO_DIR" && gittorrent whoami)
save_env B_PUBKEY "$B_PUBKEY"
echo "$B_PUBKEY"
echo
echo "${BOLD}Send this pubkey to Machine A:${RESET}  $B_PUBKEY"
echo
echo "${BOLD}Machine A then runs:${RESET}"
echo "   B_PUBKEY='$B_PUBKEY' ./demo/a2-grant-write.sh"
ok "done"
