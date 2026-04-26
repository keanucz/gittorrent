#!/usr/bin/env bash
# Machine A — step 1: init a fresh git repo, init gittorrent on top of it, make
# the first commit, and push it to the gittorrent swarm. The background seeder
# auto-starts on exit so Machine B can clone.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs

step "Machine A — Step 1: create a repo, gittorrent init, and push"

DEMO_DIR="${DEMO_DIR:-$HOME/gittorrent-demo-a}"
say "Using demo dir: $DEMO_DIR"
run "rm -rf '$DEMO_DIR' && mkdir -p '$DEMO_DIR'"
run "cd '$DEMO_DIR' && git init -b master"
run "cd '$DEMO_DIR' && git config user.email 'alice@gittorrent.demo' && git config user.name 'Alice'"
run "cd '$DEMO_DIR' && echo '# Gittorrent demo repo' > README.md"
run "cd '$DEMO_DIR' && git add README.md && git commit -m 'initial commit'"

pause

step "gittorrent init — creates a gittorrent:// URL for this repo"
run "cd '$DEMO_DIR' && gittorrent init"

# Capture the gittorrent URL from origin.
GITTORRENT_URL=$(cd "$DEMO_DIR" && git remote get-url origin)
save_env GITTORRENT_URL "$GITTORRENT_URL"
save_env DEMO_DIR "$DEMO_DIR"
ok "Recorded GITTORRENT_URL=$GITTORRENT_URL in $ENV_FILE"

pause

step "First push — data is uploaded to Autobase, auto-seeder kicks in on exit"
run "cd '$DEMO_DIR' && git push origin master"

pause

step "gittorrent whoami — this machine's long-term public key"
A_PUBKEY=$(gittorrent whoami)
save_env A_PUBKEY "$A_PUBKEY"
echo "$A_PUBKEY"

pause

step "Share with your collaborator"
echo
echo "${BOLD}Machine B runs:${RESET}"
echo "   GITTORRENT_URL='$GITTORRENT_URL' ./demo/b1-clone.sh"
echo
echo "${DIM}(the auto-seeder keeps this repo online in the background — no manual 'seed' command needed)${RESET}"
ok "done"
