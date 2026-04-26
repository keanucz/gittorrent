#!/usr/bin/env bash
# Machine A — step 1: init a fresh git repo, init pear-git on top of it, make
# the first commit, and push it to the pear swarm. The background seeder
# auto-starts on exit so Machine B can clone.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs

step "Machine A — Step 1: create a repo, pear-git init, and push"

DEMO_DIR="${DEMO_DIR:-$HOME/pear-demo-a}"
say "Using demo dir: $DEMO_DIR"
run "rm -rf '$DEMO_DIR' && mkdir -p '$DEMO_DIR'"
run "cd '$DEMO_DIR' && git init -b master"
run "cd '$DEMO_DIR' && git config user.email 'alice@pear.demo' && git config user.name 'Alice'"
run "cd '$DEMO_DIR' && echo '# Pear-git demo repo' > README.md"
run "cd '$DEMO_DIR' && git add README.md && git commit -m 'initial commit'"

pause

step "pear-git init — creates a pear:// URL for this repo"
run "cd '$DEMO_DIR' && pear-git init"

# Capture the pear URL from origin.
PEAR_URL=$(cd "$DEMO_DIR" && git remote get-url origin)
save_env PEAR_URL "$PEAR_URL"
save_env DEMO_DIR "$DEMO_DIR"
ok "Recorded PEAR_URL=$PEAR_URL in $ENV_FILE"

pause

step "First push — data is uploaded to Autobase, auto-seeder kicks in on exit"
run "cd '$DEMO_DIR' && git push origin master"

pause

step "pear-git whoami — this machine's long-term public key"
A_PUBKEY=$(pear-git whoami)
save_env A_PUBKEY "$A_PUBKEY"
echo "$A_PUBKEY"

pause

step "Share with your collaborator"
echo
echo "${BOLD}Machine B runs:${RESET}"
echo "   PEAR_URL='$PEAR_URL' ./demo/b1-clone.sh"
echo
echo "${DIM}(the auto-seeder keeps this repo online in the background — no manual 'seed' command needed)${RESET}"
ok "done"
