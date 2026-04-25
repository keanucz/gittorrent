# Task 16: bin/git-remote-pear — entry point

- **Agent:** `backend-dev`
- **Depends on:** Task 15
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/logging.md`, `architecture/env-vars.md`, `architecture/project-structure.md`

## Description

Implement `bin/git-remote-pear`, the executable entry point that git invokes for `pear://` URLs. This file wires together all lib modules (identity, corestore, autobase-repo, object-store, swarm, remote-helper) and then hands control to `createRemoteHelper`. The critical constraint: stdout is the protocol — pino must be configured to write to stderr (fd: 2) before any other module is imported.

## Files to create/modify

- `bin/git-remote-pear` — new file, must be executable (`chmod +x`)

## Acceptance Criteria

- [ ] `bin/git-remote-pear` is executable (has `#!/usr/bin/env node` shebang and `chmod +x` mode).
- [ ] The file starts with `#!/usr/bin/env node` as the very first line.
- [ ] Pino root logger is configured with `destination: pino.destination({ fd: 2 })` before any other logging can occur.
- [ ] Default log level for this binary is `warn` (override with `PEAR_GIT_LOG_LEVEL`).
- [ ] Process args: `process.argv[2]` is the remote name, `process.argv[3]` is the `pear://<base58key>` URL.
- [ ] The `pear://` URL is parsed to extract the base58 repo key and decoded to a 32-byte Buffer.
- [ ] The data directory is read from `PEAR_GIT_DATA_DIR` (default `~/.pear-git`).
- [ ] A Corestore is opened at `path.join(dataDir, 'stores', base58RepoKey)`.
- [ ] `loadIdentity(dataDir)` is called to load/create the identity.
- [ ] `openRepo(corestore, identity)` is called to open the Autobase repo.
- [ ] `createSwarm(corestore)` is called and `join(repoKey)` is called before the helper starts.
- [ ] `createObjectStore(db)` is called with the objects Hyperbee.
- [ ] `createRemoteHelper({ input: process.stdin, output: process.stdout, ... })` is called.
- [ ] On success: exits with code 0.
- [ ] On general error: logs to stderr, exits with code 1.
- [ ] On network error (no peers within timeout): logs to stderr, exits with code 3.
- [ ] On ACL/permission error: exits with code 2.
- [ ] No non-protocol bytes are ever written to stdout.
- [ ] The working clone path is `path.join(process.cwd(), '.git')` (git sets cwd to the repo root before invoking the helper).
- [ ] Linter clean.

## Key implementation notes

### URL parsing

**Resolved encoding:** `pear://` URLs use **base58** (Bitcoin alphabet) via the `bs58` npm package. This is consistent with `pear-git init` (Task 18).

```js
import bs58 from 'bs58'

const url = process.argv[3]  // pear://gK3p...QzM2
if (!url || !url.startsWith('pear://')) {
  process.stderr.write('git-remote-pear: error: expected pear:// URL\n')
  process.exit(1)
}
const encoded = url.slice('pear://'.length)
let repoKey
try {
  repoKey = Buffer.from(bs58.decode(encoded))  // 32-byte Buffer
} catch {
  process.stderr.write('git-remote-pear: error: invalid pear:// URL (bad base58)\n')
  process.exit(1)
}
```

### Corestore setup

```js
import Corestore from 'corestore'
import path from 'node:path'

const store = new Corestore(path.join(dataDir, 'stores', base58Key))
await store.ready()
```

### Objects Hyperbee

```js
const objectsCore = store.get({ name: 'objects' })
const objectsDb = new Hyperbee(objectsCore, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
await objectsDb.ready()
```

### Swarm timeout

Start a timer for `PEAR_GIT_CONNECT_TIMEOUT` (default 10 000 ms). If no peers connect before the first git command requires remote data (fetch), return network error. For push to an existing repo with no peers: the op is appended locally (offline-first) and `ok` is returned — no network needed.

### Startup sequence

1. Parse args
2. Init pino (stderr, warn level)
3. Open Corestore
4. Load identity
5. Open repo
6. Open object store
7. Start swarm and join repo topic
8. Start remote helper (hands off to stdin/stdout loop)
9. On session end: `swarm.destroy()`, close corestore, exit with appropriate code
