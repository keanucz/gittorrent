#!/usr/bin/env bash
# Machine B — step 5: now that Alice has promoted us to indexer, add a secret
# file and push it.  Alice should be able to decrypt it with her key.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/b1-clone.sh first."

step "Machine B — Step 5: fetch the latest view (so we pick up the indexer op)"
wait_for_seed 3
run "cd '$DEMO_DIR' && git pull origin master --rebase || true"

pause

step "Confirm we're now an indexer"
run "cd '$DEMO_DIR' && pear-git status"

pause

step "Create and publish a secret"
SECRET_PATH="bob-shared.env"
SECRET_FILE="$(mktemp)"
run "echo 'HACKUPC_API_KEY=totally-not-a-real-key' > '$SECRET_FILE'"
run "echo 'DB_URL=postgres://bob:demo@localhost/hack' >> '$SECRET_FILE'"
run "cat '$SECRET_FILE'"

pause

run "cd '$DEMO_DIR' && pear-git secrets add '$SECRET_FILE' --name '$SECRET_PATH'"
rm -f "$SECRET_FILE"

pause

step "Confirm the secret shows up in the list"
run "cd '$DEMO_DIR' && pear-git secrets list"

pause

step "Push — no plaintext is written to git. The encrypted blob replicates via Autobase."
run "cd '$DEMO_DIR' && git push origin master || true"

echo
echo "${BOLD}On Machine A, run:${RESET}  ./demo/a5-pull-b-secret.sh"
echo "${BOLD}On Machine C, run:${RESET}  ./demo/c1-clone.sh '$(grep ^PEAR_URL= "$ENV_FILE" | cut -d= -f2-)'"
ok "done"
