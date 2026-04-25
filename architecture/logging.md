# Logging

This is the single source of truth for logging rules. All implementation must follow this file.

---

## Library

**[pino](https://github.com/pinojs/pino)** — structured JSON, minimal overhead, works in Bare.

```js
import pino from 'pino'

const log = pino({
  level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
  redact: ['identity.secretKey', 'secretKey', '*.secretKey'],
  base: { pid: process.pid }
})
```

Each module creates a child logger with its component name:

```js
// lib/autobase-repo.js
const log = rootLogger.child({ component: 'autobase-repo' })

// lib/object-store.js
const log = rootLogger.child({ component: 'object-store' })

// lib/remote-helper.js
const log = rootLogger.child({ component: 'remote-helper' })

// lib/swarm.js
const log = rootLogger.child({ component: 'swarm' })

// bin/pear-git
const log = rootLogger.child({ component: 'cli' })
```

---

## Critical rule: stderr only in `git-remote-pear`

**stdout is exclusively the git remote helper protocol.** Any non-protocol bytes on stdout silently corrupt the git protocol.

`git-remote-pear` must initialise pino with `destination: pino.destination({ fd: 2 })` (file descriptor 2 = stderr):

```js
// bin/git-remote-pear — root logger setup
const log = pino(
  { level: process.env.PEAR_GIT_LOG_LEVEL || 'warn' },
  pino.destination({ fd: 2 })   // stderr — NEVER remove this
)
```

The `pear-git` CLI logs to stderr by default (stdout is reserved for primary output). Same `fd: 2` approach.

---

## Log levels

| Level | When to use |
|---|---|
| `error` | Unrecoverable failures: disk full, corrupted identity file, Hypercore write failure |
| `warn` | Recoverable issues: peer disconnected mid-fetch, op replay after reorder, permissions warning on identity file |
| `info` | Normal lifecycle: peer joined/left, ref updated, checkpoint signed, repo initialised |
| `debug` | Per-op detail: apply function entry/exit, object fetch request, push op appended |
| `trace` | Raw protocol: git remote helper stdin/stdout lines (redacted), Hypercore block reads |

Default level: `info`. Controlled by `PEAR_GIT_LOG_LEVEL`. In `git-remote-pear` default is `warn` to keep stderr quiet during normal git operations.

---

## Structured fields

Every log entry carries:

```json
{
  "level": "info",
  "time": 1714000000000,
  "pid": 12345,
  "component": "autobase-repo",
  "msg": "ref updated"
}
```

Additional context fields by component:

**autobase-repo:**
```json
{
  "component": "autobase-repo",
  "repoKey": "<base58>",
  "opSeq": 42,
  "ref": "refs/heads/main",
  "newSha": "abc123...",
  "writerKey": "<64-char hex pubkey>"
}
```
`opSeq` (Autobase sequence number) is the **request ID equivalent** for tracing a ref update through the system.

**object-store:**
```json
{
  "component": "object-store",
  "repoKey": "<base58>",
  "sha": "abc123...",
  "action": "put | get | miss"
}
```

**swarm:**
```json
{
  "component": "swarm",
  "repoKey": "<base58>",
  "peerId": "<hex>",
  "event": "connected | disconnected | replication-start | replication-end"
}
```

**remote-helper:**
```json
{
  "component": "remote-helper",
  "repoKey": "<base58>",
  "command": "fetch | push | list",
  "ref": "refs/heads/main"
}
```

---

## Redaction

pino's `redact` option must cover these paths to prevent accidental `secretKey` leakage:

```js
redact: [
  'identity.secretKey',
  'secretKey',
  '*.secretKey',
  '[*].secretKey'
]
```

If `publicKey` is needed in a log entry, include it explicitly. Never log the whole `identity` object.

---

## Error response format

When an error is returned to the user (CLI or protocol), it always includes the `opSeq` where applicable:

**CLI stderr:**
```
pear-git: error: non-fast-forward push rejected (opSeq=42)
```

**pino error log entry:**
```json
{
  "level": "error",
  "component": "autobase-repo",
  "opSeq": 42,
  "ref": "refs/heads/main",
  "reason": "non-fast-forward",
  "writerKey": "4a2f...",
  "msg": "ref-update rejected"
}
```

---

## What NOT to log

- `secretKey` in any form — enforced by pino redact config above
- Raw stdin/stdout bytes of the git remote helper at levels above `trace`
- Full op payloads at levels above `debug`
- Peer IPs or connection metadata at levels above `debug` (privacy)
