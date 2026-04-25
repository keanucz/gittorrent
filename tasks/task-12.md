# Task 12: Tests for swarm.js

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 01
- **Architecture files:** `architecture/project-structure.md`, `architecture/tech-stack.md`, `architecture/logging.md`, `architecture/env-vars.md`

## Description

Write failing unit tests for `lib/swarm.js` before the module exists. The swarm module manages Hyperswarm peer lifecycle: announcing a repo topic, discovering peers, and wiring Corestore replication sessions to peer connections. Tests should use in-process Hyperswarm instances to avoid external DHT dependencies.

## Files to create

- `test/swarm.test.js`

## What swarm.js will export

```js
// Create a swarm manager for one or more repos
export async function createSwarm(corestore: Corestore, opts?): Promise<SwarmManager>

// SwarmManager interface:
// {
//   join(repoKey: Buffer): Promise<void>    // announce + discover peers for this repo
//   leave(repoKey: Buffer): Promise<void>   // stop announcing, disconnect
//   connectedPeers(repoKey: Buffer): number // count of currently connected peers
//   destroy(): Promise<void>               // shut down the entire swarm
// }
```

## Acceptance Criteria

- [ ] `test/swarm.test.js` exists and fails when `lib/swarm.js` does not exist.
- [ ] Test: `createSwarm(corestore)` returns a SwarmManager without error.
- [ ] Test: `join(repoKey)` does not throw.
- [ ] Test: `leave(repoKey)` on an un-joined key does not throw.
- [ ] Test: `connectedPeers(repoKey)` returns 0 before any join.
- [ ] Test: `destroy()` closes the swarm cleanly (no unhandled rejection, process can exit).
- [ ] Test: two in-process SwarmManagers can discover and connect to each other when joining the same `repoKey` (use `Hyperswarm` with `{ bootstrap: false }` or a local bootstrap node for in-process testing).
- [ ] Test: after two peers join the same topic, `connectedPeers(repoKey)` returns 1 on each side (within a reasonable timeout, e.g. 5 seconds).
- [ ] Test: after `leave(repoKey)`, `connectedPeers(repoKey)` returns 0.
- [ ] All tests use `node:test` and `node:assert/strict`.
- [ ] Tests clean up all open Hyperswarm instances with `destroy()` in `afterEach`.

## Testing requirements

For in-process two-peer testing without a DHT, use Hyperswarm's test mode. Check the Hyperswarm docs/source for `{ bootstrap: [...] }` or use `@hyperswarm/testnet` if available. An alternative approach:

```js
import Hyperswarm from 'hyperswarm'

// Use a local test bootstrap node or direct connection
const swarm1 = new Hyperswarm({ bootstrap: [] })  // no DHT
const swarm2 = new Hyperswarm({ bootstrap: [] })

// Manually wire peers using swarm.connect() or swarm.joinPeer()
// OR use DHT-based pair: create a local HyperDHT bootstrap node
```

If in-process peer discovery proves too complex for unit testing, the two-peer connectivity test may be simplified to: verify that `join` announces the topic on the swarm (check via the `swarm.topics` or similar observable) and skip the actual peer connection test — moving full two-peer connectivity to the e2e test (Task 27).

Document this decision in the test file with a comment.

Use a timeout helper for async peer connection tests:
```js
function withTimeout (promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ])
}
```
