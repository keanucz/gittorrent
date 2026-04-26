#!/usr/bin/env bash
# Machine B — step 3: retry the push now that A has granted write access.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/b1-clone.sh first."

step "Machine B — Step 3: retry the push"
# Give Autobase a moment to propagate the add-writer op.
wait_for_seed 3
run "cd '$DEMO_DIR' && git pull origin master --rebase || true"
run "cd '$DEMO_DIR' && git push origin master"

pause

step "Tell Machine A to pull"
echo "${BOLD}On Machine A, run:${RESET}  ./demo/a3-pull-bs-file.sh"
ok "done"
