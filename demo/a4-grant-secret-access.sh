#!/usr/bin/env bash
# Machine A — step 4: upgrade Machine B to indexer so they can read/write
# secrets. Under the hood this is `pear-git invite --indexer` plus a key
# envelope distribution op so B can decrypt the shared secrets key.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/a1-init-and-push.sh first."

B_PUBKEY="${1:-${B_PUBKEY:-}}"
if [[ -z "$B_PUBKEY" ]]; then
  fail "Pass Machine B's pubkey, e.g.: B_PUBKEY=abc123 ./demo/a4-grant-secret-access.sh"
  exit 1
fi
save_env B_PUBKEY "$B_PUBKEY"

step "Machine A — Step 4: seed the shared secrets key (if not done already)"
# Creating the first secret also creates the secrets-key and envelope for
# ourselves.  We need the envelope to exist BEFORE we invite B as indexer so
# distributeSecretsKey can seal a copy for them.
SEED_FILE="$(mktemp)"
run "echo 'ALICE_BOOTSTRAP=seed-$(date +%s)' > '$SEED_FILE'"
run "cd '$DEMO_DIR' && pear-git secrets add '$SEED_FILE' --name alice-bootstrap.env"
rm -f "$SEED_FILE"

pause

step "Promote Bob to indexer (writers + secrets read/write access)"
# If Bob is already a non-indexer writer, 'invite' will refuse ("already a
# writer"). Handle both cases.
set +e
( cd "$DEMO_DIR" && pear-git invite "$B_PUBKEY" --indexer )
code=$?
set -e
if [[ $code -ne 0 ]]; then
  say "invite refused (Bob is already a writer). Re-adding at indexer level..."
  run "cd '$DEMO_DIR' && pear-git revoke '$B_PUBKEY'"
  wait_for_seed 2
  run "cd '$DEMO_DIR' && pear-git invite '$B_PUBKEY' --indexer"
fi

pause

step "Confirm both writers are indexers now"
run "cd '$DEMO_DIR' && pear-git status"

pause

step "Push the invite + key envelope ops so Bob can fetch them"
# Append-only Autobase ops also need to propagate.  They do so through the
# running seeder, but we can nudge with a git push (it forces a .update()).
run "cd '$DEMO_DIR' && git push origin master || true"

echo
echo "${BOLD}On Machine B, run:${RESET}  ./demo/b5-add-secret-after-grant.sh"
ok "done"
