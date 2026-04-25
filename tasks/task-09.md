# Task 09: secrets.js — X25519 derivation, seal/open, encrypt/decrypt

- **Agent:** `backend-dev`
- **Depends on:** Task 08, Task 05
- **Architecture files:** `architecture/secrets.md`, `architecture/data-models.md`, `architecture/security.md`, `architecture/logging.md`

## Description

Implement `lib/secrets.js` so all tests in `test/secrets.test.js` pass. This module is the only place in the codebase that performs X25519 key derivation and symmetric encryption/decryption of secret file content. The decrypted secrets key must be held in memory only for the duration of each call — never stored.

## Files to create/modify

- `lib/secrets.js`

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern secrets` passes all tests.
- [ ] `deriveX25519Pub(ed25519Pub)` calls `sodium.crypto_sign_ed25519_pk_to_curve25519` and returns a 32-byte Buffer.
- [ ] `deriveX25519Secret(ed25519Secret)` calls `sodium.crypto_sign_ed25519_sk_to_curve25519` and returns a 32-byte Buffer.
- [ ] `sealKey(secretsKey, recipientEd25519Pub)` calls `sodium.crypto_box_seal` and returns the ciphertext Buffer.
- [ ] `openKey(envelope, myEd25519Pub, myEd25519Secret)` calls `sodium.crypto_box_seal_open` and returns the plaintext Buffer or `null` on failure.
- [ ] `encryptFile(plaintext, secretsKey)` generates a random 24-byte nonce and returns `{ nonce, ciphertext }`.
- [ ] `encryptFile` uses `sodium.crypto_secretbox_easy`.
- [ ] `decryptFile(nonce, ciphertext, secretsKey)` returns plaintext Buffer or `null` on failure.
- [ ] `decryptFile` uses `sodium.crypto_secretbox_open_easy`.
- [ ] `getMySecretsKey(autobaseView, identity)` reads the entry at `'secrets-key/' + identity.publicKey.toString('hex')` from the Hyperbee view.
- [ ] `getMySecretsKey` calls `identity.openKeyEnvelope(entry.value.encryptedKey)` (not `openKey` directly) and returns the decrypted secrets key Buffer or `null`. This keeps the ed25519 secretKey inside identity.js.
- [ ] No function in this module logs or stores the decrypted `secretsKey`.
- [ ] Module uses a pino child logger with `component: 'secrets'`, logging to stderr.
- [ ] Linter clean.

## Key implementation notes

### sodium-native API for secrets

```js
import sodium from 'sodium-native'

// ECIES sealed box
// Seal: output length = input.length + sodium.crypto_box_SEALBYTES
const ciphertext = Buffer.allocUnsafe(plaintext.length + sodium.crypto_box_SEALBYTES)
sodium.crypto_box_seal(ciphertext, plaintext, x25519RecipientPub)

// Open: output length = ciphertext.length - sodium.crypto_box_SEALBYTES
const opened = Buffer.allocUnsafe(ciphertext.length - sodium.crypto_box_SEALBYTES)
const ok = sodium.crypto_box_seal_open(opened, ciphertext, x25519Pub, x25519Secret)
// ok is a boolean; return opened if true, null if false

// Secretbox
const nonce = Buffer.allocUnsafe(sodium.crypto_secretbox_NONCEBYTES) // 24 bytes
sodium.randombytes_buf(nonce)
const ct = Buffer.allocUnsafe(plaintext.length + sodium.crypto_secretbox_MACBYTES)
sodium.crypto_secretbox_easy(ct, plaintext, nonce, secretsKey)

// Secretbox open
const pt = Buffer.allocUnsafe(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
const ok = sodium.crypto_secretbox_open_easy(pt, ciphertext, nonce, secretsKey)
// return pt if ok, null if false
```

### Path validation (for callers — document in JSDoc)

Path validation for secret file paths is enforced at the CLI layer before calling `encryptFile`. This module does not validate paths. Document the constraint in JSDoc comments.

### getMySecretsKey implementation

**Resolved interface:** `getMySecretsKey(autobaseView, identity)` where `identity` is the object returned by `loadIdentity()`. It has `identity.publicKey` (Buffer) and `identity.openKeyEnvelope(encryptedKey)` (see Task 05).

```js
export async function getMySecretsKey (autobaseView, identity) {
  const entry = await autobaseView.get('secrets-key/' + identity.publicKey.toString('hex'))
  if (!entry) return null
  const { encryptedKey } = entry.value
  return identity.openKeyEnvelope(encryptedKey)  // returns Buffer or null
}
```

The ed25519 secretKey never leaves `identity.js` — the derivation and unsealing happen inside `openKeyEnvelope`. Tasks 11 and 26 both call `getMySecretsKey(view, identity)` with this signature.
