#!/usr/bin/env bash
# Machine A — step 5: pull and decrypt Bob's secret.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/a1-init-and-push.sh first."

step "Machine A — Step 5: pull the latest refs (and wait for Autobase ops)"
wait_for_seed 3
run "cd '$DEMO_DIR' && git pull origin master --rebase || true"

pause

step "List all secrets visible to the swarm"
run "cd '$DEMO_DIR' && pear-git secrets list"

pause

step "Decrypt Bob's secret using Alice's sealed key envelope"
run "cd '$DEMO_DIR' && pear-git secrets get bob-shared.env"

ok "bob-shared.env successfully decrypted on Machine A"
