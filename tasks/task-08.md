# Task 08: Tests for secrets.js

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 04
- **Architecture files:** `architecture/secrets.md`, `architecture/data-models.md`, `architecture/security.md`

## Description

Write failing unit tests for `lib/secrets.js` before the module exists. This module handles all cryptographic operations for the secrets system: ed25519→X25519 key derivation, ECIES sealed-box seal/open, and XSalsa20-Poly1305 encrypt/decrypt. Tests must verify both the happy path and failure cases (wrong key, tampered ciphertext, key version mismatches).

## Files to create

- `test/secrets.test.js`

## What secrets.js will export

```js
// Key derivation
export function deriveX25519Pub(ed25519Pub: Buffer): Buffer         // 32 bytes
export function deriveX25519Secret(ed25519Secret: Buffer): Buffer   // 32 bytes

// Key envelope operations
export function sealKey(secretsKey: Buffer, recipientEd25519Pub: Buffer): Buffer
export function openKey(envelope: Buffer, myEd25519Pub: Buffer, myEd25519Secret: Buffer): Buffer | null

// Secret file encryption
export function encryptFile(plaintext: Buffer, secretsKey: Buffer): { nonce: Buffer, ciphertext: Buffer }
export function decryptFile(nonce: Buffer, ciphertext: Buffer, secretsKey: Buffer): Buffer | null

// High-level: get this peer's secrets key from the Autobase view
export async function getMySecretsKey(autobaseView: Hyperbee, identity: Identity): Promise<Buffer | null>
```

## Acceptance Criteria

- [ ] `test/secrets.test.js` exists and fails when `lib/secrets.js` does not exist.
- [ ] Test: `deriveX25519Pub(ed25519Pub)` returns a 32-byte Buffer.
- [ ] Test: `deriveX25519Secret(ed25519Secret)` returns a 32-byte Buffer.
- [ ] Test: `deriveX25519Pub` and `deriveX25519Secret` are deterministic — same input produces same output.
- [ ] Test: seal/open round-trip — `openKey(sealKey(key, recipientPub), recipientPub, recipientSecret)` returns the original key.
- [ ] Test: `openKey` returns `null` when the envelope was sealed for a different recipient.
- [ ] Test: `openKey` returns `null` when the envelope is truncated or tampered (flip a byte).
- [ ] Test: `sealKey` output length is 80 bytes (`crypto_box_SEALBYTES + 32` = 48 + 32 = 80 bytes... actually `crypto_box_SEALBYTES` = 48, so sealed(32-byte key) = 80 bytes total — verify with `sodium.crypto_box_SEALBYTES`).
- [ ] Test: `encryptFile`/`decryptFile` round-trip — decrypt returns plaintext equal to original.
- [ ] Test: `encryptFile` returns a `nonce` of exactly 24 bytes (`crypto_secretbox_NONCEBYTES`).
- [ ] Test: `encryptFile` ciphertext length is `plaintext.length + 16` (`crypto_secretbox_MACBYTES`).
- [ ] Test: `decryptFile` returns `null` when the wrong `secretsKey` is used.
- [ ] Test: `decryptFile` returns `null` when the ciphertext is tampered (flip a byte).
- [ ] Test: `decryptFile` returns `null` when the nonce is wrong.
- [ ] Test: `encryptFile` produces a different nonce each call (not a static nonce).
- [ ] Test: path validation — `getMySecretsKey` returns `null` when no envelope entry exists in the view.
- [ ] Test: `getMySecretsKey` returns the secrets key when a valid envelope for this identity exists in the view.
- [ ] All tests generate real keypairs using `sodium-native` directly (since `identity.js` is available from Task 05 — use it if convenient, or generate keys inline).
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

Generate test keypairs using sodium-native directly:

```js
import sodium from 'sodium-native'

function generateKeypair () {
  const pub = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
  const sec = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(pub, sec)
  return { publicKey: pub, secretKey: sec }
}
```

For `getMySecretsKey`, create a mock Hyperbee (in-memory) and populate it with an encrypted envelope entry at key `secrets-key/<hex(pub)>` with value `{ encryptedKey: Buffer, keyVersion: 1 }`. The mock identity object needs `publicKey` (Buffer) and the secretKey accessible for `openKey`.

For the "null when no envelope" test, pass an empty in-memory Hyperbee.

For a "wrong recipient" test: seal for keypair A, try to open with keypair B → expect `null`.
