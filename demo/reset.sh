#!/usr/bin/env bash
# Nuke all demo state on this machine.  Run between rehearsals.
# -----------------------------------------------------------------------------

source "$(dirname "$0")/_lib.sh"

step "Tearing down demo state on $(hostname)"
run "pkill -f 'gittorrent seed' || true"
run "rm -f ./gittorrent-demo.env"
run "rm -rf \"$HOME/gittorrent-demo-a\" \"$HOME/gittorrent-demo-b\" \"$HOME/gittorrent-demo-c\""
run "rm -rf \"$HOME/.gittorrent/stores\""
run "rm -rf /tmp/gittorrent-rpc /tmp/gittorrent-sockets"

ok "reset complete"
