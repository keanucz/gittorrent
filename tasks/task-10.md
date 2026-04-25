# Task 10: Tests for autobase-repo.js

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 03, Task 05
- **Architecture files:** `architecture/data-models.md`, `architecture/auth.md`, `architecture/security.md`, `architecture/logging.md`

## Description

Write failing unit tests for `lib/autobase-repo.js` before the module exists. This is the most complex module in the project: it wraps Autobase and implements the deterministic `apply()` function that processes all 6 op types. Tests must cover ACL enforcement, signature verification, fast-forward checks, ref conflict handling, secrets key envelope apply logic, and the determinism constraint of `apply()`.

## Files to create

- `test/autobase-repo.test.js`

## What autobase-repo.js will export

```js
// Open or create an autobase-backed repo
export async function openRepo(corestore: Corestore, identity: Identity, opts?): Promise<Repo>

// Repo interface:
// {
//   key: Buffer,                       // 32-byte repo public key (Autobase key)
//   getRef(ref: string): Promise<string | null>    // sha or null
//   updateRef(ref, oldSha, newSha, force?): Promise<{ ok: boolean, reason?: string }>
//   addWriter(pubkey: Buffer, indexer: boolean): Promise<void>
//   removeWriter(pubkey: Buffer): Promise<void>
//   getWriters(): Promise<Array<{ key: Buffer, indexer: boolean }>>
//   view: Hyperbee,                    // the Autobase ref view (view-refs)
//   secretsView: Hyperbee,             // view-secrets-keys
//   close(): Promise<void>
// }
```

## Acceptance Criteria

- [ ] `test/autobase-repo.test.js` exists and fails when `lib/autobase-repo.js` does not exist.
- [ ] Test setup creates an in-memory Corestore (using RAM storage) and generates identity keypairs.
- [ ] Test: `openRepo` returns a Repo object with a `key` Buffer of length 32.
- [ ] Test: `getRef('refs/heads/main')` returns `null` on a fresh repo.
- [ ] Test: `updateRef` by the creator sets the ref and `getRef` returns the new SHA.
- [ ] Test: `updateRef` with `oldSha` matching current value succeeds (fast-forward OK).
- [ ] Test: `updateRef` with `oldSha` not matching current value and `force: false` returns `{ ok: false, reason: 'non-fast-forward' }`.
- [ ] Test: `updateRef` with `force: true` and mismatched `oldSha` succeeds.
- [ ] Test: `updateRef` with `oldSha: null` succeeds when the ref does not exist (new branch).
- [ ] Test: `updateRef` with `oldSha: null` when the ref already exists and `force: false` returns `{ ok: false, reason: 'non-fast-forward' }`.
- [ ] Test: `addWriter(pubkey, false)` followed by `getWriters()` includes the new writer.
- [ ] Test: `addWriter(pubkey, true)` makes the new peer an indexer.
- [ ] Test: `removeWriter(pubkey)` removes the writer; `getWriters()` no longer includes them.
- [ ] Test: `removeWriter` on the last indexer returns an error or rejects (refused).
- [ ] Test: invalid signature on a `ref-update` op (manually crafted bad op) is silently dropped — the ref is not updated.
- [ ] Test: only indexers can issue `add-writer` ops — a non-indexer attempt is dropped.
- [ ] Test: `secrets-key-envelope` op with valid indexer signature updates `secretsView` at the correct key.
- [ ] Test: `secrets-key-envelope` with wrong `keyVersion` is dropped.
- [ ] Test: `secrets-key-rotate` with `newKeyVersion === currentVersion + 1` increments the version.
- [ ] Test: `secrets-key-rotate` with wrong `newKeyVersion` is dropped.
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

For in-memory Corestore:

```js
import Corestore from 'corestore'
import RAM from 'random-access-memory'

const store = new Corestore(RAM)
```

For testing bad signatures: construct an op with a signature field filled with zeros or random bytes. The `apply()` function must reject it.

For testing non-indexer `add-writer`: open a second Repo instance as a non-indexer writer (invited by the first), then attempt to call `addWriter` from it — expect a rejection or silent drop.

For multi-writer tests (replication), two Corestores can replicate via a pipe:
```js
const [s1, s2] = store1.replicate(true), store2.replicate(false)
s1.pipe(s2).pipe(s1)
```

Keep multi-writer tests simple — verify that the basic ACL semantics work. The e2e test (Task 27) covers full two-peer scenarios.

For the `apply()` determinism requirement: test that calling the apply logic (or simulating it via the Repo's high-level API) twice with the same ops in the same order produces the same view state.
