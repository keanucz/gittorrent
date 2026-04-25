# Task 28: Build and install scripts

- **Agent:** `backend-dev`
- **Depends on:** Task 16, Task 26
- **Architecture files:** `architecture/build.md`, `architecture/project-structure.md`

## Description

Implement the build and install scripts that produce standalone binaries via `bare-bundle` and place them on `$PATH`. After this task, a user can run `npm install && ./scripts/build.sh && ./scripts/install.sh` and then use `git clone pear://...` with vanilla git. Also add the `.env.example` file with all documented env vars.

## Files to create/modify

- `scripts/build.sh` — bundle both binaries with bare-bundle
- `scripts/install.sh` — copy binaries to `$INSTALL_DIR` (default `~/.local/bin`)
- `.env.example` — documented env var template

## Acceptance Criteria

- [ ] `scripts/build.sh` is executable (`chmod +x`).
- [ ] `scripts/install.sh` is executable (`chmod +x`).
- [ ] `bash scripts/build.sh` produces `dist/git-remote-pear` and `dist/pear-git`.
- [ ] Both binaries in `dist/` are executable.
- [ ] `dist/git-remote-pear` starts with a Bare or Node shebang line (whatever `bare-bundle` produces).
- [ ] `dist/pear-git` starts with a Bare or Node shebang line.
- [ ] `bash scripts/install.sh` copies both binaries to `$INSTALL_DIR` (default `~/.local/bin`).
- [ ] `install.sh` prints a warning if `$INSTALL_DIR` is not on `$PATH`.
- [ ] `install.sh` uses `INSTALL_DIR` env var if set, otherwise defaults to `~/.local/bin`.
- [ ] `.env.example` contains commented-out entries for all 5 env vars: `PEAR_GIT_DATA_DIR`, `PEAR_GIT_LOG_LEVEL`, `PEAR_GIT_BOOTSTRAP_NODES`, `PEAR_GIT_SEEDER_KEYS`, `PEAR_GIT_CONNECT_TIMEOUT`.
- [ ] `npm run build` in `package.json` runs `bash scripts/build.sh`.
- [ ] `npm run install:bins` in `package.json` runs `bash scripts/install.sh`.
- [ ] Linter clean (shell scripts are not linted by eslint — no action needed).

## Key implementation notes

### build.sh content

```bash
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
```

### install.sh content

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

cp dist/git-remote-pear "$INSTALL_DIR/git-remote-pear"
cp dist/pear-git        "$INSTALL_DIR/pear-git"

chmod +x "$INSTALL_DIR/git-remote-pear"
chmod +x "$INSTALL_DIR/pear-git"

echo "Installed to $INSTALL_DIR"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "WARNING: $INSTALL_DIR is not on your PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi
```

### .env.example content

```bash
# Root data directory for identity file and per-repo Corestores
# PEAR_GIT_DATA_DIR=~/.pear-git

# Log level: error | warn | info | debug | trace
# (git-remote-pear defaults to warn; pear-git defaults to info)
# PEAR_GIT_LOG_LEVEL=info

# Override HyperDHT bootstrap nodes (comma-separated host:port pairs)
# For fully private deployments: run your own with `npx hyperdht --bootstrap`
# PEAR_GIT_BOOTSTRAP_NODES=dht1.example.com:49737,dht2.example.com:49737

# Repos to seed on daemon startup (comma-separated pear:// URLs)
# PEAR_GIT_SEEDER_KEYS=pear://gK3p...QzM2,pear://xY7a...

# Peer connection timeout in milliseconds (default: 10000)
# PEAR_GIT_CONNECT_TIMEOUT=10000
```

### bare-bundle availability note

If `bare-bundle` is not yet stable or has packaging issues at implementation time, document the npm fallback in a comment in `build.sh`:
```bash
# Fallback if bare-bundle has issues:
# npm pack && npm install -g gittorrent-*.tgz
```

Do not change the build approach — just document the fallback.
