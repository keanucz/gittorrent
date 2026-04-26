#!/usr/bin/env bash
# Nuke all demo state on this machine.  Run between rehearsals.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"

step "Tearing down demo state on $(hostname)"
run "pkill -f 'pear-git seed' || true"
run "rm -f ./pear-demo.env"
run "rm -rf \"$HOME/pear-demo-a\" \"$HOME/pear-demo-b\" \"$HOME/pear-demo-c\""
run "rm -rf \"$HOME/.pear-git/stores\""
run "rm -rf /tmp/pear-git-rpc /tmp/pear-git-sockets"

ok "reset complete"
