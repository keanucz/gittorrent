# Task 27: e2e test — clone-push-pull with two in-process peers

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 16, Task 26
- **Architecture files:** `architecture/overview.md`, `architecture/protocols.md`, `architecture/data-models.md`, `architecture/secrets.md`

## Description

Write a comprehensive end-to-end integration test that exercises the full gittorrent stack with two in-process peers. This test does NOT use mock objects — it uses real Autobase, real Hyperbee, real sodium-native, and real git processes. It is the final acceptance test that proves the system works end-to-end.

## Files to create

- `test/e2e/clone-push-pull.test.js`

## Acceptance Criteria

- [ ] Test exists and passes end-to-end.
- [ ] Test: **Setup** — Peer A runs `initRepo()` in a temp git repository with one initial commit.
- [ ] Test: **Clone** — Peer B runs `git clone pear://<key>` using the `bin/git-remote-pear` binary on PATH (by setting `PATH` env var to include `bin/`). Peer B's clone has the same commit history as Peer A.
- [ ] Test: **Push from A** — Peer A makes a new commit and runs `git push origin main`. Peer B's repo reflects the new commit after pull.
- [ ] Test: **Push from B** — Peer B makes a different commit and pushes. Peer A's repo reflects it.
- [ ] Test: **Conflict** — Peer A and Peer B both commit independently (without pulling). One push succeeds; the other gets a `non-fast-forward` rejection, same as standard git.
- [ ] Test: **Disconnect A, pull from B** — Peer A's swarm is destroyed. Peer B can still pull from its local Corestore (offline read).
- [ ] Test: **Secrets** — Peer A runs `pear-git secrets add .env`. Peer B (after reconnect) can read the secret with `pear-git secrets get .env`.
- [ ] Test: **Invite** — Peer A invites Peer B with a `add-writer` op. Peer B can now push refs.
- [ ] Test: entire test completes in under 60 seconds.
- [ ] Test: all temp directories and swarm instances are cleaned up in `afterEach` even on failure.
- [ ] Uses `node:test` and `node:assert/strict`.

## Testing requirements

### Two-peer setup

```js
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import Corestore from 'corestore'
import { openRepo } from '../../lib/autobase-repo.js'
import { createSwarm } from '../../lib/swarm.js'
import { loadIdentity } from '../../lib/identity.js'

let tmpA, tmpB, storeA, storeB, repoA, repoB, swarmA, swarmB

test.before(async () => {
  tmpA = await mkdtemp(join(tmpdir(), 'pear-git-e2e-a-'))
  tmpB = await mkdtemp(join(tmpdir(), 'pear-git-e2e-b-'))
  // ... open corestores, identities, repos, swarms ...
})

test.after(async () => {
  await swarmA?.destroy()
  await swarmB?.destroy()
  await storeA?.close()
  await storeB?.close()
  await rm(tmpA, { recursive: true, force: true })
  await rm(tmpB, { recursive: true, force: true })
})
```

### Peer replication

For in-process replication between the two peers without a real DHT, use the Corestore's `replicate()` method directly:

```js
const [s1, s2] = [storeA.replicate(true), storeB.replicate(false)]
s1.pipe(s2).pipe(s1)
```

Or use Hyperswarm with a local bootstrap node (preferred for a more realistic test):

```js
import HyperDHT from 'hyperdht'

const bootstrap = new HyperDHT({ ephemeral: true, bootstrap: [] })
await bootstrap.ready()
const bootstrapAddr = { host: '127.0.0.1', port: bootstrap.address().port }

const swarmA = new Hyperswarm({ bootstrap: [bootstrapAddr] })
const swarmB = new Hyperswarm({ bootstrap: [bootstrapAddr] })
```

### git operations

Use `child_process.execFile` with the temp directories as the cwd:

```js
const { stdout } = await exec('git', ['log', '--oneline'], { cwd: repoAWorkingDir })
```

For `git push` / `git pull`, ensure `bin/git-remote-pear` is on PATH:
```js
const env = { ...process.env, PATH: `${join(process.cwd(), 'bin')}:${process.env.PATH}` }
await exec('git', ['push', 'origin', 'main'], { cwd, env })
```

### Timeouts

Each git operation should complete within 10 seconds. Wrap with a timeout:
```js
function withTimeout (p, ms = 10000) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))])
}
```
