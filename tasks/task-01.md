# Task 01: Project scaffolding, package.json, test runner

- **Agent:** `backend-dev`
- **Depends on:** —
- **Architecture files:** `architecture/project-structure.md`, `architecture/tech-stack.md`, `architecture/build.md`, `architecture/env-vars.md`, `architecture/external-deps.md`, `architecture/logging.md`

## Description

Bootstrap the full repository skeleton so every subsequent task has a known, consistent foundation to build on. This task installs all npm dependencies, creates the directory tree, configures the test runner and linter, and adds scaffolding files. By the end, `npm test` must run and pass a smoke test, and `npm run lint` must execute without error.

## Files to create/modify

- `package.json` — dependencies, scripts, engine field
- `.gitignore` — node_modules, dist/, .env, .env.*, *.pem, *.key, secrets/
- `.env.example` — documents all supported env vars
- `eslint.config.js` — ESLint flat config for Node ESM
- `lib/.gitkeep` — placeholder to track directory
- `bin/.gitkeep`
- `test/.gitkeep`
- `test/e2e/.gitkeep`
- `scripts/.gitkeep`
- `test/smoke.test.js` — one passing test to confirm the test runner works

## Acceptance Criteria

- [ ] `npm install` completes without error. All runtime and dev deps installed.
- [ ] `npm test` discovers and runs `test/smoke.test.js`; the smoke test passes.
- [ ] `npm run lint` runs ESLint across `lib/`, `bin/`, `test/` without error (no files yet means no error).
- [ ] `npm run build` script entry exists in `package.json` (the script itself just echoes "run scripts/build.sh" — the actual build is Task 28).
- [ ] `package.json` includes `"type": "module"` (ESM throughout).
- [ ] `package.json` includes `"engines": { "node": ">=20" }`.
- [ ] All runtime dependencies from the table below are listed in `dependencies`.
- [ ] `bare-bundle` and `eslint` are in `devDependencies`.
- [ ] `.env.example` contains commented-out entries for all 5 env vars.

## Runtime dependencies to install

```
autobase
hyperbee
hyperswarm
hypercore
corestore
compact-encoding
sodium-native
pino
bs58
```

`bs58` is the base58 encoder/decoder used for `pear://` URL keys.

## Dev dependencies to install

```
bare-bundle
eslint
```

## npm scripts to define in package.json

```json
{
  "test":         "node --test 'test/**/*.test.js'",
  "lint":         "eslint lib/ bin/ test/",
  "build":        "bash scripts/build.sh",
  "install:bins": "bash scripts/install.sh"
}
```

## Smoke test content (`test/smoke.test.js`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('smoke: test runner is working', () => {
  assert.equal(1 + 1, 2)
})
```

## Testing requirements

The smoke test is self-contained. No mocking. Confirms that:
- Node's built-in test runner (`node --test`) finds and executes the file.
- The test runner exits 0 on pass, non-zero on failure.

## Key implementation notes

- Use Node's built-in test runner (`node:test`). Do NOT add `mocha`, `jest`, `vitest`, or any other test framework.
- ESM (`"type": "module"`) is required because the Pear/Hypercore ecosystem uses ESM exclusively.
- The `sodium-native` package compiles a native addon via `node-gyp` during `npm install`. This requires `build-essential` (Linux) or Xcode Command Line Tools (macOS). Document this in a comment in `package.json` under a `"README"` key or in the existing `architecture/` directory — do NOT create a new `.md` file.
- `compact-encoding` npm package name is `compact-encoding` (not the Github path shown in architecture files — that has a different author slug).
- Do not load `.env` files in this task. The env var loading pattern is documented in `architecture/env-vars.md` and will be wired in later tasks.
