# Task 06: Tests for object-store.js

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 01
- **Architecture files:** `architecture/data-models.md`, `architecture/project-structure.md`

## Description

Write failing unit tests for `lib/object-store.js` before the module exists. The object store is a Hyperbee KV store keyed by 40-char hex SHA with gzip-compressed git object bytes as values. Tests must verify the full has/get/put cycle including gzip round-trip, SHA validation, and correct behaviour on cache misses.

## Files to create

- `test/object-store.test.js`

## What object-store.js will export

```js
// Creates/opens an object store backed by a Hyperbee on a Hypercore.
// db: a Hyperbee instance (passed in — not created internally)
export function createObjectStore(db: Hyperbee): ObjectStore

// ObjectStore interface:
// {
//   has(sha: string): Promise<boolean>
//   get(sha: string): Promise<Buffer | null>   // returns decompressed git object bytes, or null
//   put(sha: string, objectBytes: Buffer): Promise<void>  // compresses and stores
// }
```

## Acceptance Criteria

- [x] `test/object-store.test.js` exists and fails when `lib/object-store.js` does not exist.
- [x] Test setup creates an in-memory Hypercore + Hyperbee (using `RAM` storage from `hypercore`).
- [x] Test: `has(sha)` returns `false` for a SHA that has not been put.
- [x] Test: `put(sha, bytes)` followed by `has(sha)` returns `true`.
- [x] Test: `put(sha, bytes)` followed by `get(sha)` returns a Buffer deep-equal to the original `bytes` (gzip round-trip is transparent to the caller).
- [x] Test: `get(sha)` for a SHA that was never put returns `null`.
- [x] Test: `put` with an invalid SHA (not 40-char hex) throws or rejects with a descriptive error.
- [x] Test: `has` with an invalid SHA throws or rejects.
- [x] Test: `get` with an invalid SHA throws or rejects.
- [x] Test: storing and retrieving a large object (100 KB random bytes) round-trips correctly.
- [x] Test: storing two different objects with different SHAs returns each independently.
- [x] Test: values stored in Hyperbee are gzip-compressed (verify by reading the raw Hyperbee entry and checking it is NOT equal to the original bytes — i.e., compression actually happened).
- [x] All tests use `node:test` and `node:assert/strict`.
- [x] Tests are self-contained with no file system side effects (use in-memory storage).

## Testing requirements

To create an in-memory Hyperbee for testing:

```js
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import RAM from 'random-access-memory'

function createTestDb () {
  const core = new Hypercore(RAM)
  return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
}
```

Note: `random-access-memory` may need to be added as a dev dependency if not transitively available. Check if it is already available via hypercore's transitive deps first.

For SHA fixtures, use valid-looking 40-char hex strings:
```js
const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const INVALID_SHA = 'not-a-sha'
```

For git object bytes, use a representative fixture — the canonical format is `type SP size NUL content`:
```js
const content = Buffer.from('hello world')
const header = Buffer.from(`blob ${content.length}\0`)
const objectBytes = Buffer.concat([header, content])
```
