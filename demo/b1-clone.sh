#!/usr/bin/env bash
# Machine B — step 1: clone the repo Machine A created.
# Expects PEAR_URL either in env or passed as $1.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs

PEAR_URL="${1:-${PEAR_URL:-}}"
if [[ -z "$PEAR_URL" ]]; then
  fail "Pass the pear URL, e.g.: PEAR_URL=pear://... ./demo/b1-clone.sh"
  exit 1
fi

DEMO_DIR="${DEMO_DIR:-$HOME/pear-demo-b}"
save_env PEAR_URL "$PEAR_URL"
save_env DEMO_DIR "$DEMO_DIR"

step "Machine B — Step 1: clone $PEAR_URL"
run "rm -rf '$DEMO_DIR' && mkdir -p '$(dirname "$DEMO_DIR")'"
run "git clone '$PEAR_URL' '$DEMO_DIR'"

pause

step "Confirm the clone landed"
run "ls -la '$DEMO_DIR'"
run "cat '$DEMO_DIR/README.md'"

pause

step "Machine B's long-term public key"
B_PUBKEY=$(cd "$DEMO_DIR" && pear-git whoami)
save_env B_PUBKEY "$B_PUBKEY"
echo "$B_PUBKEY"
echo
echo "${BOLD}Send this pubkey to Machine A:${RESET}  $B_PUBKEY"
echo
echo "${BOLD}Machine A then runs:${RESET}"
echo "   B_PUBKEY='$B_PUBKEY' ./demo/a2-grant-write.sh"
ok "done"
