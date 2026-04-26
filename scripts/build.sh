#!/usr/bin/env bash
set -euo pipefail

echo "Building gittorrent binaries..."

mkdir -p dist/

npx bare-bundle bin/git-remote-gittorrent --output dist/git-remote-gittorrent
chmod +x dist/git-remote-gittorrent

npx bare-bundle bin/gittorrent --output dist/gittorrent
chmod +x dist/gittorrent

echo ""
echo "Built:"
echo "  dist/git-remote-gittorrent"
echo "  dist/gittorrent"
echo ""
echo "Run ./scripts/install.sh to install to PATH."
