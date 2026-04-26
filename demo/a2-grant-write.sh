#!/usr/bin/env bash
# Machine A — step 2: grant Machine B write access (non-indexer writer).
# Takes B's pubkey from env B_PUBKEY or $1.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/a1-init-and-push.sh first."

B_PUBKEY="${1:-${B_PUBKEY:-}}"
if [[ -z "$B_PUBKEY" ]]; then
  fail "Pass Machine B's pubkey, e.g.: B_PUBKEY=abc123 ./demo/a2-grant-write.sh"
  exit 1
fi
save_env B_PUBKEY "$B_PUBKEY"

step "Machine A — Step 2: invite Bob ($B_PUBKEY) as a writer"
run "cd '$DEMO_DIR' && gittorrent invite '$B_PUBKEY'"

pause

step "Confirm the writer list"
run "cd '$DEMO_DIR' && gittorrent status"

pause

step "Machine B can now retry its push"
echo "${BOLD}On Machine B, run:${RESET}  ./demo/b3-push-after-grant.sh"
ok "done"
