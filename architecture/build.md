# Build

*(Replaces `docker.md` — this is a P2P CLI tool installed on each peer's machine, not a service.)*

---

## Goal

`./scripts/build.sh` produces two standalone binaries. `./scripts/install.sh` puts them on `$PATH`. After install, `git clone pear://…` works with vanilla git.

```
dist/
├── git-remote-pear    # Installed to PATH; invoked by git for pear:// URLs
└── pear-git           # User-facing CLI
```

---

## Dev workflow (no build step needed)

During development, run directly with Node. No compilation required.

```bash
npm install
node bin/pear-git init
node bin/git-remote-pear <remote-name> <pear-url>
```

For `git-remote-pear` to be found by git automatically during dev:

```bash
export PATH="$PWD/bin:$PATH"
# Now: git clone pear://... works from any directory
```

---

## Build tool

**[bare-bundle](https://github.com/holepunchto/bare-bundle)** — bundles JS + native addons into a standalone Bare binary.

Install as a dev dependency:
```bash
npm install --save-dev bare-bundle
```

---

## Build script

`scripts/build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Building gittorrent binaries..."

mkdir -p dist/

# Bundle the git remote helper
npx bare-bundle bin/git-remote-pear --output dist/git-remote-pear
chmod +x dist/git-remote-pear

# Bundle the CLI
npx bare-bundle bin/pear-git --output dist/pear-git
chmod +x dist/pear-git

echo ""
echo "Built:"
echo "  dist/git-remote-pear"
echo "  dist/pear-git"
echo ""
echo "Run ./scripts/install.sh to install to PATH."
```

---

## Install script

`scripts/install.sh`:

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

# Warn if not on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "WARNING: $INSTALL_DIR is not on your PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi
```

---

## One-liner for new users

```bash
npm install && ./scripts/build.sh && ./scripts/install.sh
```

---

## Platform notes

| Concern | Detail |
|---|---|
| Platform-specific binaries | `bare-bundle` produces binaries for the host OS/arch. Build on the target platform (or use CI matrix for distribution). |
| Native addons | `sodium-native` has a native addon compiled by `node-gyp` during `npm install`. Requires a C compiler (`build-essential` on Debian, Xcode CLT on macOS). |
| Bare runtime | Bare must be installed on the target machine if using `bare-bundle` (bundles JS but not the Bare runtime itself). For a fully self-contained binary, use **[bare-pkg](https://github.com/holepunchto/bare-pkg)** instead — it embeds the runtime. |
| Minimum Node version | Node 20+ for development. Bare version: follow `pear` ecosystem recommendations (check `package.json` engine field). |

---

## npm scripts (package.json)

```json
{
  "scripts": {
    "build":   "bash scripts/build.sh",
    "install:bins": "bash scripts/install.sh",
    "test":    "node --test test/**/*.test.js",
    "lint":    "eslint lib/ bin/ test/"
  }
}
```

---

## CI (stretch goal)

A minimal GitHub Actions workflow would:
1. `npm install` on ubuntu-latest and macos-latest
2. `npm run build`
3. Upload `dist/` as release artifacts

Not required for v1; document here for future reference.
