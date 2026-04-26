#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

cp dist/git-remote-gittorrent "$INSTALL_DIR/git-remote-gittorrent"
cp dist/gittorrent        "$INSTALL_DIR/gittorrent"

chmod +x "$INSTALL_DIR/git-remote-gittorrent"
chmod +x "$INSTALL_DIR/gittorrent"

echo "Installed to $INSTALL_DIR"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "WARNING: $INSTALL_DIR is not on your PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi
