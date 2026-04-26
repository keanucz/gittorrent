#!/usr/bin/env bash
set -euo pipefail

echo "Building gittorrent binaries..."

mkdir -p dist/

npx bare-bundle bin/git-remote-pear --output dist/git-remote-pear
chmod +x dist/git-remote-pear

npx bare-bundle bin/pear-git --output dist/pear-git
chmod +x dist/pear-git

echo ""
echo "Built:"
echo "  dist/git-remote-pear"
echo "  dist/pear-git"
echo ""
echo "Run ./scripts/install.sh to install to PATH."
