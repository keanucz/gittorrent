#!/usr/bin/env bash
# Machine B — step 6: pull + decrypt Alice's secret.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/b1-clone.sh first."

step "Machine B — Step 6: pull + decrypt alice-shared.env"
wait_for_seed 3
run "cd '$DEMO_DIR' && git pull origin master --rebase || true"

pause

run "cd '$DEMO_DIR' && gittorrent secrets list"

pause

run "cd '$DEMO_DIR' && gittorrent secrets get alice-shared.env"

ok "end-to-end secrets flow demonstrated"
