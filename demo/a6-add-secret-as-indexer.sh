#!/usr/bin/env bash
# Machine A — step 6: Alice adds her own secret.  Bob should be able to
# decrypt it too (symmetric — both are indexers sharing the same secrets key).
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/a1-init-and-push.sh first."

step "Machine A — Step 6: publish alice-shared.env"
SECRET_FILE="$(mktemp)"
run "echo 'OPENAI_API_KEY=sk-demo-alice' > '$SECRET_FILE'"
run "echo 'SLACK_WEBHOOK=https://hooks.slack.com/services/demo' >> '$SECRET_FILE'"
run "cat '$SECRET_FILE'"

pause

run "cd '$DEMO_DIR' && pear-git secrets add '$SECRET_FILE' --name alice-shared.env"
rm -f "$SECRET_FILE"

pause

step "Push the encrypted payload"
run "cd '$DEMO_DIR' && git push origin master || true"

echo
echo "${BOLD}On Machine B, run:${RESET}  ./demo/b6-pull-a-secret.sh"
ok "done"
