#!/usr/bin/env bash
# Machine A — step 3: pull the change Bob pushed and show the diff.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/a1-init-and-push.sh first."

step "Machine A — Step 3: pull Bob's changes"
run "cd '$DEMO_DIR' && git pull origin master --rebase"

pause

step "Confirm Bob's line is now in the file"
run "cd '$DEMO_DIR' && git log --oneline"
run "cd '$DEMO_DIR' && cat README.md"

ok "write-access flow demonstrated end-to-end"
