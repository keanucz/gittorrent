# Task 22: pear-git seed subcommand

- **Agent:** `backend-dev`
- **Depends on:** Task 21, Task 18
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/env-vars.md`

## Description

Implement `pear-git seed`, a long-lived process that joins the Hyperswarm for one or more repos and acts as an always-on replica. It emits JSON-line events to stdout as peers connect and blocks replicate. It must handle SIGINT/SIGTERM cleanly. The `--human` flag switches to a human-readable format.

## Files to create/modify

- `lib/commands/seed.js`
- `bin/pear-git` — add `seed` dispatch case

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern pear-git-seed` passes all tests.
- [ ] `run(args, opts)` parses `pear://` URLs from args and from `PEAR_GIT_SEEDER_KEYS` env var.
- [ ] For each repo key: calls `swarm.join(repoKey)` (using the SwarmManager from lib/swarm.js).
- [ ] On `swarm` peer-joined event: writes `{ "event": "peer-joined", "repoKey": "<base58>", "peerId": "<hex>", "time": <ms> }` as a JSON line to stdout.
- [ ] On `swarm` peer-left event: writes `{ "event": "peer-left", ... }` JSON line.
- [ ] On blocks synced: writes `{ "event": "blocks-synced", "repoKey": "<base58>", "count": <n>, "time": <ms> }` JSON line.
- [ ] `--human` flag: writes formatted human-readable lines instead of JSON (e.g. `[10:32:15] peer joined gK3p... (ab12...)`).
- [ ] On `SIGINT` or `SIGTERM`: calls `swarm.destroy()` for all repos and exits 0.
- [ ] If `opts.signal` is provided (for testing): listens to `abort` event as the shutdown trigger.
- [ ] If no repos are specified (no args, no env var): exits 1 with `pear-git: error: no repos to seed`.
- [ ] Linter clean.

## Key implementation notes

### Event loop management

```js
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function cleanup () {
  await swarm.destroy()
  process.exit(0)
}
```

For the `opts.signal` version used in tests:
```js
if (opts.signal) {
  opts.signal.addEventListener('abort', cleanup, { once: true })
}
```

### JSON line output

```js
function emitEvent (out, obj) {
  out.write(JSON.stringify(obj) + '\n')
}
```

### Parsing PEAR_GIT_SEEDER_KEYS

```js
const envKeys = process.env.PEAR_GIT_SEEDER_KEYS
  ? process.env.PEAR_GIT_SEEDER_KEYS.split(',').map(s => s.trim())
  : []
const allUrls = [...args, ...envKeys]
```

### Swarm event forwarding

Swarm events from lib/swarm.js — check what events the SwarmManager emits and wire accordingly. If SwarmManager doesn't emit events, use the underlying `swarm.on('connection', ...)` from Hyperswarm directly and track by repo key.

A clean approach: the `seed` command creates the SwarmManager, then for each connection event:
```js
swarm.on('connection', (conn, info) => {
  const peerId = conn.remotePublicKey.toString('hex')
  // Determine which repoKey this connection belongs to
  emitEvent(out, { event: 'peer-joined', repoKey, peerId, time: Date.now() })
  conn.on('close', () => {
    emitEvent(out, { event: 'peer-left', repoKey, peerId, time: Date.now() })
  })
})
```
