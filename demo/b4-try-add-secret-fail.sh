#!/usr/bin/env bash
# Machine B — step 4: try to add a secret BEFORE being granted indexer access.
# Should fail because only indexers can publish secret-put ops.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/b1-clone.sh first."

step "Machine B — Step 4: attempt to add a secret"
SECRET_FILE="$(mktemp)"
run "echo 'BOB_SECRET=from-machine-b-$(date +%s)' > '$SECRET_FILE'"
run "cat '$SECRET_FILE'"

pause

set +e
run "cd '$DEMO_DIR' && pear-git secrets add '$SECRET_FILE' --name bobs-secret.env"
code=$?
set -e

if [[ $code -ne 0 ]]; then
  ok "as expected, non-indexer cannot publish a secret (exit $code)"
else
  fail "Bob was able to add a secret without being an indexer — that's a bug!"
  exit 1
fi

B_PUBKEY=$(cd "$DEMO_DIR" && pear-git whoami)
echo
echo "${BOLD}Send this pubkey to Machine A and ask to be upgraded to indexer:${RESET}  $B_PUBKEY"
echo "${BOLD}Machine A runs:${RESET}  B_PUBKEY='$B_PUBKEY' ./demo/a4-grant-secret-access.sh"
