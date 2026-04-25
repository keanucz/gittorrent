# Task 23: Tests for pear-git status

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 11
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`

## Description

Write failing unit tests for `pear-git status` before it is implemented. The `status` subcommand shows the current repo state including the pear URL, connected peer count, Autobase signed length, pending ops, rejected pushes, writer count, and secrets key info. Tests cover both human-readable and `--json` output modes.

## Files to create

- `test/pear-git-status.test.js`

## What will be tested

```js
// lib/commands/status.js
export async function run(args: string[], opts: {
  dataDir: string,
  cwd: string,
  repo?: Repo,       // injected for testing
  swarm?: SwarmManager  // injected for testing
}): Promise<void>
```

## Acceptance Criteria

- [ ] `test/pear-git-status.test.js` exists and fails when the status command does not exist.
- [ ] Test: human output contains `Repo: pear://<key>`.
- [ ] Test: human output contains `Peers: <n> connected`.
- [ ] Test: human output contains `Signed length: <n>`.
- [ ] Test: human output contains `Pending ops: <n>`.
- [ ] Test: human output contains `Rejected pushes: <n>`.
- [ ] Test: human output contains `Writers: <total> (<indexers> indexer)`.
- [ ] Test: human output contains `Secrets: key v<n>, <m> files` when a secrets key exists.
- [ ] Test: human output contains `Secrets: none` when no secrets key.
- [ ] Test: `--json` flag outputs a single JSON object (parseable with `JSON.parse`).
- [ ] Test: JSON output has fields `repoKey`, `peers`, `signedLength`, `pendingOps`, `rejectedPushes`, `writers`, `indexers`, `secrets`.
- [ ] Test: `secrets` field in JSON is `{ keyVersion: 0, fileCount: 0, hasKey: false }` when no secrets key.
- [ ] Test: exit code is 0 on success.
- [ ] Test: exit code is 1 when not inside a pear-git repo (no `origin` set to `pear://`).
- [ ] Test: exit code is 3 when no peers connected (but still shows local state).
- [ ] All tests inject `repo` and `swarm` mocks — no real Autobase or Hyperswarm.
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

Repo mock for status:
```js
const repoMock = {
  key: Buffer.alloc(32, 1),
  getWriters: async () => [
    { key: Buffer.alloc(32, 1), indexer: true },
    { key: Buffer.alloc(32, 2), indexer: false }
  ],
  // Autobase stats:
  signedLength: 42,
  pendingLength: 1,
  view: {
    // Hyperbee — for reading secrets-key-version and counting rejections
    get: async (key) => {
      if (key === 'secrets-key-version') return { value: 2 }
      return null
    }
  },
  secretsView: {
    get: async (key) => {
      if (key === 'secrets-key-version') return { value: 2 }
      return null
    },
    createReadStream: () => /* stream of secrets-key/* entries */ ...
  }
}
```

Swarm mock:
```js
const swarmMock = {
  connectedPeers: (key) => 3
}
```

Capture stdout by passing an output option:
```js
export async function run (args, opts = {}) {
  const out = opts.output || process.stdout
  // ...
}
```

For the "not a pear-git repo" test: run with a temp dir that has no git remote or a non-pear origin.
