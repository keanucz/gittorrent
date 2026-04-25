# Task 13: swarm.js — Hyperswarm peer lifecycle and Corestore replication

- **Agent:** `backend-dev`
- **Depends on:** Task 12, Task 11
- **Architecture files:** `architecture/project-structure.md`, `architecture/tech-stack.md`, `architecture/logging.md`, `architecture/env-vars.md`

## Description

Implement `lib/swarm.js` so all tests in `test/swarm.test.js` pass. This module wires Hyperswarm peer discovery to Corestore replication sessions. When a peer connects for a given repo topic, a Corestore replication session is established automatically — Autobase, the ref view, the object store, and the secrets store all replicate transparently.

## Files to create/modify

- `lib/swarm.js`

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern swarm` passes all tests.
- [ ] `createSwarm(corestore, opts)` creates a Hyperswarm instance and returns a SwarmManager.
- [ ] `join(repoKey)` calls `swarm.join(topic)` where `topic` is `crypto.createHash('sha256').update(repoKey).digest()` (32-byte topic derived from the repo key).
- [ ] `join(repoKey)` sets up a `swarm.on('connection', ...)` handler that calls `corestore.replicate(conn)` for each new peer connection.
- [ ] `leave(repoKey)` calls `discovery.destroy()` on the join handle to stop announcing/discovering for that topic.
- [ ] `connectedPeers(repoKey)` returns the number of active connections for that topic.
- [ ] `destroy()` calls `swarm.destroy()` and waits for all connections to close.
- [ ] `PEAR_GIT_BOOTSTRAP_NODES` env var is passed as the `bootstrap` option to Hyperswarm if set (parse comma-separated `host:port` pairs).
- [ ] `PEAR_GIT_CONNECT_TIMEOUT` env var is respected — if no peers connect within the timeout, emit a warning log.
- [ ] Pino child logger `component: 'swarm'` with fields `repoKey` (base58), `peerId`, `event`.
- [ ] Linter clean.

## Key implementation notes

### Hyperswarm basic usage

```js
import Hyperswarm from 'hyperswarm'

const swarm = new Hyperswarm()

swarm.on('connection', (conn, info) => {
  // Wire Corestore replication to the peer connection
  const stream = corestore.replicate(conn)
  // conn is already a Duplex stream; pipe if needed
  // Actually: corestore.replicate returns the stream, pass the socket directly
  store.replicate(conn)
})

const discovery = swarm.join(topic, { server: true, client: true })
await discovery.flushed()  // Wait for initial DHT announce
```

### Topic derivation

The Autobase key (repo key) is 32 bytes. The Hyperswarm topic must also be 32 bytes. Use the repo key directly as the topic (it is already a random 32-byte value that uniquely identifies the repo):

```js
const topic = repoKey  // 32-byte Buffer — use directly as Hyperswarm topic
```

Or use a hash for namespace separation (implementation choice — document it).

### Bootstrap nodes from env

```js
const bootstrapEnv = process.env.PEAR_GIT_BOOTSTRAP_NODES
const bootstrap = bootstrapEnv
  ? bootstrapEnv.split(',').map(s => {
      const [host, port] = s.trim().split(':')
      return { host, port: Number(port) }
    })
  : undefined  // undefined = use default Holepunch DHT nodes

const swarm = new Hyperswarm({ bootstrap })
```

### Per-repo connection tracking

Keep a `Map<string, Set<connection>>` keyed by repo key hex to track connected peers per repo. Update on `connection` and `close` events.

### Corestore replication

```js
swarm.on('connection', (conn) => {
  store.replicate(conn)
  log.info({ event: 'connected', peerId: conn.remotePublicKey.toString('hex') })
  conn.on('close', () => {
    log.info({ event: 'disconnected', peerId: conn.remotePublicKey.toString('hex') })
  })
})
```
