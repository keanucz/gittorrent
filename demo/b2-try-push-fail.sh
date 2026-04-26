#!/usr/bin/env bash
# Machine B — step 2: edit a file and try to push.  This should FAIL because
# B has not been granted write access yet.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/b1-clone.sh first."

step "Machine B — Step 2: make a change"
run "cd '$DEMO_DIR' && git config user.email 'bob@pear.demo' && git config user.name 'Bob'"
run "cd '$DEMO_DIR' && echo 'Added by Bob on Machine B' >> README.md"
run "cd '$DEMO_DIR' && git add README.md && git commit -m 'Bob: add line to README'"

pause

step "Attempt to push — should FAIL because Bob is not a writer yet"
set +e
run "cd '$DEMO_DIR' && git push origin master"
code=$?
set -e

if [[ $code -ne 0 ]]; then
  ok "as expected, push was rejected (exit code $code)"
else
  fail "push unexpectedly succeeded"
  exit 1
fi

pause

step "What now?"
echo "Send your pubkey to Machine A — they need to invite you as a writer."
B_PUBKEY=$(cd "$DEMO_DIR" && pear-git whoami)
echo
echo "${BOLD}Machine A runs:${RESET}"
echo "   B_PUBKEY='$B_PUBKEY' ./demo/a2-grant-write.sh"
echo
echo "${BOLD}Then Machine B runs:${RESET}"
echo "   ./demo/b3-push-after-grant.sh"
