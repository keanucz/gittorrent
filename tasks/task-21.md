# Task 21: Tests for pear-git seed

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 13
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/env-vars.md`

## Description

Write failing unit tests for `pear-git seed` before it is implemented. The `seed` subcommand is a long-lived process that joins the Hyperswarm for one or more repos and emits JSON-line events as peers connect and blocks sync. Tests cover the startup behaviour, JSON output format, the `--human` flag, SIGINT shutdown, and `PEAR_GIT_SEEDER_KEYS` env var.

## Files to create

- `test/pear-git-seed.test.js`

## What will be tested

```js
// lib/commands/seed.js
export async function run(args: string[], opts: { dataDir, swarm?, signal? }): Promise<void>
// args: ['pear://...', 'pear://...'] — zero or more URLs
// opts.signal: AbortSignal for clean shutdown in tests
```

## Acceptance Criteria

- [ ] `test/pear-git-seed.test.js` exists and fails when the seed command does not exist.
- [ ] Test: `run([], opts)` with no args and no `PEAR_GIT_SEEDER_KEYS` exits with an appropriate error or no-op (no repos to seed).
- [ ] Test: `run(['pear://<key>'], opts)` starts without error (with a mocked swarm).
- [ ] Test: when a peer joins, stdout receives a JSON line matching `{ event: 'peer-joined', repoKey: string, peerId: string, time: number }`.
- [ ] Test: when a peer leaves, stdout receives `{ event: 'peer-left', ... }`.
- [ ] Test: `--human` flag switches output to a human-readable line instead of JSON.
- [ ] Test: `PEAR_GIT_SEEDER_KEYS=pear://<key>` env var causes that repo to be seeded even when no args are given.
- [ ] Test: `opts.signal` abort causes `run` to resolve cleanly (no unhandled rejection, mock swarm `destroy` is called).
- [ ] Test: stdout output is valid JSON lines — each line parses with `JSON.parse` without error.
- [ ] All tests use a mocked SwarmManager (not a real Hyperswarm).
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

The seed command needs to emit events from the swarm. Use an EventEmitter-based mock:

```js
import { EventEmitter } from 'node:events'

class MockSwarm extends EventEmitter {
  join (key) { return { key, destroy: async () => {} } }
  destroy () { return Promise.resolve() }
  connectedPeers (key) { return 0 }
}

const mockSwarm = new MockSwarm()
```

Then simulate events during the test:
```js
// After starting the seeder:
mockSwarm.emit('peer-joined', { repoKey: 'abc', peerId: 'def', time: Date.now() })
```

Capture stdout by passing an output stream to the run function:
```js
export async function run(args, opts = {}) {
  const out = opts.output || process.stdout
  // ... write JSON lines to out ...
}
```

For the abort signal test:
```js
const ac = new AbortController()
const runPromise = run(['pear://abc'], { swarm: mockSwarm, signal: ac.signal, output: captureStream })
ac.abort()
await runPromise  // should resolve without error
```
