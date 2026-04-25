# Task 17: Tests for pear-git init

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 11
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/project-structure.md`, `architecture/env-vars.md`

## Description

Write failing unit tests for the `pear-git init` subcommand before it is implemented. `init` creates a new Autobase-backed repo in the current directory, sets the `origin` remote to the `pear://` URL, and writes a `.gitignore`. Tests must verify stdout output (just the URL), the `origin` remote, the written files, and error handling.

## Files to create

- `test/pear-git-init.test.js`

## What will be tested

The `init` logic will live in `bin/pear-git` or a helper module it calls. For testability, the init logic should be exportable:

```js
// From bin/pear-git or a lib/commands/init.js helper
export async function initRepo(opts: {
  cwd: string,         // directory to initialise
  dataDir: string,     // PEAR_GIT_DATA_DIR
  name?: string        // --name alias (unused in v1 but accepted)
}): Promise<{ url: string }>
```

## Acceptance Criteria

- [ ] `test/pear-git-init.test.js` exists and fails when the init function does not exist.
- [ ] Test setup: create a fresh temporary directory with a bare `git init` already run.
- [ ] Test: `initRepo({ cwd, dataDir })` resolves without error.
- [ ] Test: return value has a `url` field matching `/^pear:\/\/[A-Za-z0-9]+$/`.
- [ ] Test: after init, `git remote get-url origin` in the cwd returns the same URL.
- [ ] Test: `.gitignore` file exists in cwd after init.
- [ ] Test: `.gitignore` contains `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/`.
- [ ] Test: calling `initRepo` twice in the same directory returns an error (already a repo — OR the URL is stable and the second call is idempotent — verify with the architecture).
- [ ] Test: the returned URL starts with `pear://`.
- [ ] Test: `dataDir/identity` file exists after init (identity was created).
- [ ] Test: a Corestore directory exists at `dataDir/stores/<key>` after init.
- [ ] All tests use temporary directories cleaned up in `afterEach`.
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

Use `node:child_process` `execFile` to call real git for verifying the remote:
```js
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)

const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd })
assert.match(stdout.trim(), /^pear:\/\//)
```

The test needs a pre-existing git repo in `cwd`:
```js
await exec('git', ['init'], { cwd })
await exec('git', ['commit', '--allow-empty', '-m', 'init'], { cwd })
```

Do not start a real Hyperswarm in these tests. The `openRepo` call will use an in-memory or on-disk Corestore at the temp data dir — that is fine for unit tests since Autobase itself doesn't require network.

Mock or stub the swarm if needed to prevent network calls during testing.
