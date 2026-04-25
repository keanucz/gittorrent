#!/usr/bin/env bash
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
cp dist/pear-git "$INSTALL_DIR/pear-git"
cp dist/git-remote-pear "$INSTALL_DIR/git-remote-pear"
chmod +x "$INSTALL_DIR/pear-git" "$INSTALL_DIR/git-remote-pear"
echo "Installed to $INSTALL_DIR"
