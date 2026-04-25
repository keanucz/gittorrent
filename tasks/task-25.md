# Task 25: Tests for pear-git secrets subcommands

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 09, Task 11
- **Architecture files:** `architecture/secrets.md`, `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/security.md`

## Description

Write failing unit tests for all five `pear-git secrets` subcommands (`add`, `get`, `list`, `rm`, `rotate`) before they are implemented. These tests cover the full secrets lifecycle: key creation on first add, encryption/decryption, path validation, key version mismatch handling, rotation, and all permission checks.

## Files to create

- `test/pear-git-secrets.test.js`

## What will be tested

```js
// lib/commands/secrets.js — all subcommands in one module
export async function runAdd(args, opts): Promise<void>
// args: ['<local-file>', '--name', '<store-path>?']

export async function runGet(args, opts): Promise<void>
// args: ['<store-path>', '--output', '<local-file>?']

export async function runList(args, opts): Promise<void>
// args: ['--json'?]

export async function runRm(args, opts): Promise<void>
// args: ['<store-path>']

export async function runRotate(args, opts): Promise<void>
// args: []
```

## Acceptance Criteria

- [x] `test/pear-git-secrets.test.js` exists and fails when `lib/commands/secrets.js` does not exist.
- [x] Test: `add .env` reads a local `.env` file, encrypts it, stores in the secrets Hyperbee, stdout `Added .env (key version: 1)`.
- [x] Test: `add .env --name config/.env` stores under key `config/.env`.
- [x] Test: first `add` when `keyVersion === 0` generates a new key, appends a `secrets-key-envelope` op for self.
- [x] Test: `add` when not a writer exits 2.
- [x] Test: `add` when no secrets key is available exits 2 with appropriate error.
- [x] Test: `add` with an invalid store path (contains `..`) exits 2 with path validation error.
- [x] Test: `add` with a path exceeding 255 chars exits 2.
- [x] Test: `get .env` decrypts and prints content to stdout.
- [x] Test: `get .env --output /tmp/out.env` writes decrypted content to the output file.
- [x] Test: `get` for a non-existent path exits 2 with "path not found".
- [x] Test: `get` when key version of stored file does not match available key version exits 2 with "key version mismatch".
- [x] Test: `get` when no secrets key envelope exists exits 2.
- [x] Test: `list` with no secrets outputs nothing (or empty line).
- [x] Test: `list` with two secrets outputs their paths, one per line.
- [x] Test: `list --json` outputs a JSON array of paths.
- [x] Test: `list` exits 2 when no secrets key available.
- [x] Test: `rm .env` deletes the entry, stdout `Removed .env`.
- [x] Test: `rm` for a non-existent path exits 2.
- [x] Test: `rm` when not a writer exits 2.
- [x] Test: `rotate` generates a new key, re-encrypts all files with the new key, appends `secrets-key-rotate` op + one `secrets-key-envelope` op per current writer.
- [x] Test: `rotate` stdout: `Rotated to key version 2. Re-encrypted 2 files.`
- [x] Test: `rotate` exits 2 when caller is not an indexer.
- [x] Test: `rotate` exits 2 when no secrets key exists yet.
- [x] All tests use in-memory mocks for the repo, secrets Hyperbee, and identity.
- [x] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

Create a secrets Hyperbee mock using in-memory Hypercore + Hyperbee (same pattern as object-store tests).

For the `add` test fixture, create a real temp file:
```js
import { writeFile, rm } from 'node:fs/promises'

const tmpFile = path.join(tmpDir, '.env')
await writeFile(tmpFile, 'SECRET=hunter2\n')
```

Mock identity that exposes both `publicKey` and a callable to derive the secretKey (since `getMySecretsKey` needs it). Since `identity.js` by design does not expose `secretKey`, the secrets command will need to receive it differently — check the decision made in Task 09 and test accordingly.

For `secrets list --json` test:
```js
const output = getOutput()
const parsed = JSON.parse(output)
assert.ok(Array.isArray(parsed))
```

For key version mismatch test: store a file with `keyVersion: 2` in the Hyperbee, but provide an identity with only a `keyVersion: 1` envelope.
