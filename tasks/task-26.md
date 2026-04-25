# Task 26: pear-git secrets add, get, list, rm, rotate

- **Agent:** `backend-dev`
- **Depends on:** Task 25, Task 20
- **Architecture files:** `architecture/secrets.md`, `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/security.md`, `architecture/data-models.md`

## Description

Implement all five `pear-git secrets` subcommands. This task implements the complete secrets lifecycle: first-use key generation, per-file encryption/decryption, listing, removal, and key rotation. All secret file content is encrypted with XSalsa20-Poly1305; keys are distributed via ECIES sealed boxes in Autobase ops.

## Files to create/modify

- `lib/commands/secrets.js` — all five subcommand implementations
- `bin/pear-git` — add `secrets` dispatch with sub-dispatch for `add`, `get`, `list`, `rm`, `rotate`

## Acceptance Criteria

- [x] `npm test -- --test-name-pattern pear-git-secrets` passes all tests.

### secrets add

- [x] Validates the store path against `/^[\w.\-\/]+$/`, no `..` components, max 255 chars. Exits 2 on violation.
- [x] Reads the local file content into a Buffer.
- [x] If `keyVersion === 0`: generates a new 32-byte random key, appends a `secrets-key-envelope` op for self, increments view version to 1.
- [x] Encrypts file content with `encryptFile(content, secretsKey)`.
- [x] Encodes value as `keyVersion(4 bytes LE) + nonce(24 bytes) + ciphertext` and writes to the secrets Hyperbee.
- [x] Stdout: `Added <store-path> (key version: <n>)`.

### secrets get

- [x] Reads the secrets Hyperbee entry at the given path.
- [x] If not found: exits 2 with `pear-git: error: secret not found: <path>`.
- [x] Decodes `keyVersion` from the 4-byte LE prefix.
- [x] Gets the secrets key via `getMySecretsKey`.
- [x] If key version mismatches: exits 2 with `pear-git: error: key version mismatch — rotation in progress, retry shortly`.
- [x] Decrypts with `decryptFile(nonce, ciphertext, secretsKey)`.
- [x] Without `--output`: writes plaintext to stdout.
- [x] With `--output <path>`: writes to file (creates or overwrites).

### secrets list

- [x] Iterates all entries in the secrets Hyperbee.
- [x] Without `--json`: one path per line to stdout.
- [x] With `--json`: JSON array of path strings to stdout.
- [x] Exits 2 if no secrets key available (not a writer or no envelope).

### secrets rm

- [x] Deletes the entry from the secrets Hyperbee (`db.del(path)`).
- [x] If path not found: exits 2.
- [x] Verifies caller is a writer (has a secrets key envelope).
- [x] Stdout: `Removed <path>`.

### secrets rotate

- [x] Verifies caller is an indexer. Exits 2 if not.
- [x] Reads all entries from the secrets Hyperbee.
- [x] Decrypts each with the old key, re-encrypts with the new key, writes back with `newKeyVersion`.
- [x] Appends a `secrets-key-rotate` Autobase op.
- [x] Appends a `secrets-key-envelope` op for every current writer.
- [x] Stdout: `Rotated to key version <n>. Re-encrypted <m> files.`
- [x] Linter clean.

## Key implementation notes

### Encoding the secrets Hyperbee value

```js
// Write
const versionBuf = Buffer.allocUnsafe(4)
versionBuf.writeUInt32LE(keyVersion, 0)
const value = Buffer.concat([versionBuf, nonce, ciphertext])
await secretsDb.put(path, value)

// Read
const keyVersion = entry.value.readUInt32LE(0)
const nonce = entry.value.slice(4, 28)      // 24 bytes
const ciphertext = entry.value.slice(28)    // rest
```

### Path validation

```js
const PATH_RE = /^[\w.\-\/]+$/

function validateSecretPath (p) {
  if (!PATH_RE.test(p) || p.includes('..') || p.length > 255) {
    process.stderr.write(`pear-git: error: invalid secret path: ${p}\n`)
    process.exit(2)
  }
}
```

### First-use key generation

```js
import sodium from 'sodium-native'

const secretsKey = Buffer.allocUnsafe(32)
sodium.randombytes_buf(secretsKey)
```

Then immediately append a `secrets-key-envelope` op (see Task 20 pattern for how to sign and append envelope ops).

### secrets rotate — op sequence

1. Read old `keyVersion` from `secretsView.get('secrets-key-version')`.
2. Generate new key.
3. Re-encrypt all files (read → decrypt with old key → encrypt with new key → write with `newKeyVersion`).
4. Append `secrets-key-rotate` op (signed by indexer identity).
5. Wait for op to apply (view reflects `newKeyVersion`).
6. Append one `secrets-key-envelope` op per writer (for each writer pubkey from `repo.getWriters()`).

### Secrets Hyperbee access

The secrets Hyperbee (`secrets/core`) is separate from the Autobase view. Open it via:
```js
const secretsCore = corestore.get({ name: 'secrets' })
const secretsDb = new Hyperbee(secretsCore, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
```

This db is written directly by `lib/secrets.js` — not via Autobase ops.
