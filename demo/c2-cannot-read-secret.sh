#!/usr/bin/env bash
# Machine C — step 2: attempt to decrypt a secret we were never granted
# access to.  Should fail because no key envelope was sealed for us.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"
check_prereqs
load_env
require_env DEMO_DIR "Run ./demo/c1-clone.sh first."

step "Machine C — Step 2: try to decrypt bob-shared.env"
set +e
run "cd '$DEMO_DIR' && gittorrent secrets get bob-shared.env"
code=$?
set -e

if [[ $code -ne 0 ]]; then
  ok "as expected, Machine C cannot decrypt — no key envelope on file (exit $code)"
else
  fail "Machine C was able to decrypt without access — that's a bug!"
  exit 1
fi

echo
echo "${BOLD}The encrypted ciphertext IS in the swarm — but it's useless without Alice/Bob's private keys.${RESET}"
echo "${BOLD}This is the difference between 'public availability' and 'authorised access'.${RESET}"
ok "done"
