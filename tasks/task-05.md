# Task 05: identity.js — ed25519 keypair load/create/sign/verify

- **Agent:** `backend-dev`
- **Depends on:** Task 04
- **Architecture files:** `architecture/data-models.md`, `architecture/auth.md`, `architecture/security.md`, `architecture/logging.md`, `architecture/env-vars.md`

## Description

Implement `lib/identity.js` so all tests in `test/identity.test.js` pass. This module is the single place in the entire codebase where the user's `secretKey` lives in memory. Security rules are non-negotiable: the secret key must never appear on the exported object, never be logged, and the identity file must be created with mode `0600`.

## Files to create/modify

- `lib/identity.js`

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern identity` passes all tests.
- [ ] `loadIdentity(dataDir)` generates a new ed25519 keypair (via `sodium-native`) if no identity file exists.
- [ ] The identity file is written as JSON with fields `publicKey` (64-char hex), `secretKey` (128-char hex), `createdAt` (ISO 8601).
- [ ] The identity file is created with mode `0600` using `fs.chmod` or `fs.writeFile` with mode option.
- [ ] `loadIdentity` reads an existing identity file and returns the same keypair (no regeneration).
- [ ] On load, if the file permissions are not `0600`, a pino `warn` log is emitted but execution continues (no throw).
- [ ] The returned object has `publicKey` (32-byte Buffer) and `sign`/`verify` methods.
- [ ] The returned object does NOT have a `secretKey` property.
- [ ] `identity.sign(data)` calls `sodium.crypto_sign_detached(sig, data, secretKey)` and returns the 64-byte signature Buffer.
- [ ] `identity.verify(sig, data, pubkey)` calls `sodium.crypto_sign_verify_detached` and returns a boolean.
- [ ] `identity.openKeyEnvelope(encryptedKey)` derives the X25519 keypair from the ed25519 keypair (using `sodium.crypto_sign_ed25519_sk_to_curve25519` and `sodium.crypto_sign_ed25519_pk_to_curve25519`), calls `sodium.crypto_box_seal_open`, and returns the decrypted Buffer or `null` on failure. The ed25519 `secretKey` never leaves the closure.
- [ ] The pino logger for this module uses `rootLogger.child({ component: 'identity' })` and logs to stderr (fd: 2).
- [ ] `secretKey` does not appear in any log output (pino redact config covers it).
- [ ] Linter clean.

## Key implementation notes

### sodium-native usage

```js
import sodium from 'sodium-native'

// Key generation
const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES) // 32 bytes
const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES) // 64 bytes
sodium.crypto_sign_keypair(publicKey, secretKey)

// Sign
const sig = Buffer.allocUnsafe(sodium.crypto_sign_BYTES) // 64 bytes
sodium.crypto_sign_detached(sig, data, secretKey)

// Verify
const valid = sodium.crypto_sign_verify_detached(sig, data, pubkey)
```

Note: sodium-native's `secretKey` for ed25519 is 64 bytes (private key concatenated with public key — sodium convention). When serialising to the identity file, store all 64 bytes as 128-char hex.

### Module structure

Keep `secretKey` in a closure, not on any exported object:

```js
export async function loadIdentity (dataDir) {
  // ... load or generate ...
  // secretKey is a local variable in this scope — never on the returned object
  return {
    publicKey,  // Buffer (32 bytes)
    sign (data) { /* uses secretKey from closure */ },
    verify (sig, data, pubkey) { /* pure, no secretKey needed */ },
    openKeyEnvelope (encryptedKey) {
      // Derives X25519 keypair from ed25519 keypair (closure), calls crypto_box_seal_open.
      // Returns decrypted Buffer or null. secretKey stays in this closure.
      const x25519Secret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
      const x25519Pub    = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
      sodium.crypto_sign_ed25519_sk_to_curve25519(x25519Secret, secretKey)
      sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, publicKey)
      const out = Buffer.allocUnsafe(encryptedKey.length - sodium.crypto_box_SEALBYTES)
      const ok  = sodium.crypto_box_seal_open(out, encryptedKey, x25519Pub, x25519Secret)
      return ok ? out : null
    }
  }
}
```

### Data dir resolution

If `dataDir` is not provided, use `process.env.PEAR_GIT_DATA_DIR || path.join(os.homedir(), '.pear-git')`. Create the directory if it doesn't exist (`mkdir -p` equivalent).

### File path

Identity file: `path.join(dataDir, 'identity')`.

### Validation on load

After reading the file:
1. Parse JSON.
2. Check `publicKey` is a 64-char hex string.
3. Check `secretKey` is a 128-char hex string.
4. Check both are present.
5. If validation fails: throw an Error with a clear message (do not silently generate a new key on corruption).
