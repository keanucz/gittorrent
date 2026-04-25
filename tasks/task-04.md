# Task 04: Tests for identity.js

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 01
- **Architecture files:** `architecture/data-models.md`, `architecture/auth.md`, `architecture/security.md`, `architecture/logging.md`, `architecture/env-vars.md`

## Description

Write failing unit tests for `lib/identity.js` before the module exists. These tests define the complete contract for ed25519 keypair lifecycle: creation, persistence to disk, loading, signing, and verification. Security requirements are strict: the secret key must never appear in logs, the identity file must be created with mode 0600, and sign/verify must be correct using `sodium-native`.

## Files to create

- `test/identity.test.js`

## What identity.js will export

```js
// Load identity from PEAR_GIT_DATA_DIR/identity (creates if absent)
// Returns an identity object. secretKey is held internally — not on the returned object.
export async function loadIdentity(dataDir?: string): Promise<Identity>

// Identity object interface (what loadIdentity returns):
// {
//   publicKey: Buffer,   // 32-byte ed25519 public key
//   sign(data: Buffer): Buffer,   // returns 64-byte signature
//   verify(sig: Buffer, data: Buffer, pubkey: Buffer): boolean
// }
//
// secretKey is NEVER on the returned object.
```

## Acceptance Criteria

- [ ] `test/identity.test.js` exists and fails when `lib/identity.js` does not exist.
- [ ] Test: calling `loadIdentity(tmpDir)` on a fresh directory creates `tmpDir/identity` file.
- [ ] Test: the identity file is valid JSON with `publicKey`, `secretKey`, `createdAt` fields.
- [ ] Test: the identity file is created with mode `0600` (use `fs.stat` to check `mode & 0o777 === 0o600`).
- [ ] Test: `publicKey` in the file is a 64-char hex string (32 bytes).
- [ ] Test: `secretKey` in the file is a 128-char hex string (64 bytes).
- [ ] Test: calling `loadIdentity(tmpDir)` a second time returns the same `publicKey` (idempotent).
- [ ] Test: `identity.sign(data)` returns a 64-byte Buffer.
- [ ] Test: `identity.verify(sig, data, identity.publicKey)` returns `true` for a valid signature produced by `sign`.
- [ ] Test: `identity.verify(sig, data, otherPubkey)` returns `false` (wrong key).
- [ ] Test: `identity.verify(tamperedSig, data, identity.publicKey)` returns `false` (tampered signature).
- [ ] Test: the returned identity object does NOT have a `secretKey` property (security check).
- [ ] Test: `identity.publicKey` is a Buffer (not a hex string) with `byteLength === 32`.
- [ ] All tests use a temporary directory (via `os.tmpdir()` + unique suffix) and clean up after themselves.
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

Use `node:fs/promises` and `node:os` — no extra packages needed.

```js
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, beforeEach, afterEach } from 'node:test'

let tmpDir
beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'pear-git-test-')) })
afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }) })
```

For the sign/verify tests, use a fixed 32-byte data buffer:
```js
const data = Buffer.alloc(32, 0xAB)
```

Do not import `sodium-native` directly in the test — the tests should only interact through the `identity.js` public API.
