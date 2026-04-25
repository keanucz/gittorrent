# Task 07: object-store.js — Hyperbee content-addressed git object store

- **Agent:** `backend-dev`
- **Depends on:** Task 06
- **Architecture files:** `architecture/data-models.md`, `architecture/project-structure.md`, `architecture/logging.md`

## Description

Implement `lib/object-store.js` so all tests in `test/object-store.test.js` pass. This module provides the content-addressed storage layer for git objects. Objects are gzip-compressed before storage. Because SHAs are derived from content, concurrent writes of the same SHA from multiple peers are always idempotent — no conflict resolution needed.

## Files to create/modify

- `lib/object-store.js`

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern object-store` passes all tests.
- [ ] `createObjectStore(db)` returns an object with `has`, `get`, `put` methods.
- [ ] `put(sha, objectBytes)` validates the SHA against `/^[0-9a-f]{40}$/` and throws `TypeError` with a descriptive message if invalid.
- [ ] `put(sha, objectBytes)` gzip-compresses `objectBytes` before writing to Hyperbee.
- [ ] `get(sha)` validates the SHA, returns `null` for missing entries, and gunzip-decompresses the stored value before returning.
- [ ] `has(sha)` validates the SHA and returns a boolean.
- [ ] Pino child logger with `component: 'object-store'` logs at `debug` for each `put`/`get`/miss action.
- [ ] Log entries include `sha` and `action` fields (`'put'`, `'get'`, `'miss'`).
- [ ] No `repoKey` in log entries here — that context is added by the caller.
- [ ] Linter clean.

## Key implementation notes

### gzip using Node built-ins

```js
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)
```

### SHA validation

```js
const SHA_RE = /^[0-9a-f]{40}$/

function validateSha (sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
    throw new TypeError(`Invalid SHA: ${sha}`)
  }
}
```

### Module shape

```js
export function createObjectStore (db) {
  return {
    async has (sha) { ... },
    async get (sha) { ... },
    async put (sha, objectBytes) { ... }
  }
}
```

The `db` parameter is a Hyperbee instance. The store does not create its own Hyperbee — that is the caller's responsibility. This keeps the module testable with an in-memory Hyperbee.

### Hyperbee key/value encoding

The Hyperbee passed in should have `keyEncoding: 'utf-8'` and `valueEncoding: 'binary'`. The store writes raw gzipped Buffers as values.

### Concurrency note

`put` is idempotent — writing the same SHA twice is safe (same bytes, same gzip output with the same input). No locking needed.
