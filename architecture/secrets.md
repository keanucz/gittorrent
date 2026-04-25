# Secrets

Encrypted sharing of secret files (`.env`, credentials, certificates) via the existing P2P swarm, authenticated to the repo's Autobase writer ACL. An agent should be able to implement `lib/secrets.js` from this file alone.

---

## Purpose

Secret files must travel the same P2P replication path as git objects — every writer gets a copy — but their content must be unreadable to anyone outside the writer ACL, and unreadable to a revoked writer after key rotation. The system piggybacks entirely on existing infrastructure: `sodium-native` for crypto, the `secrets/` Hyperbee for storage, and Autobase ops for authenticated key distribution.

---

## Cryptographic primitives

| Primitive | Library call | Purpose |
|---|---|---|
| XSalsa20-Poly1305 | `crypto_secretbox` / `crypto_secretbox_open` | Symmetric encryption of secret file content |
| ECIES sealed box | `crypto_box_seal` / `crypto_box_seal_open` | Asymmetric encryption of the secrets key to each writer |
| X25519 key derivation | `crypto_sign_ed25519_pk_to_curve25519` / `_sk_to_curve25519` | Derive encryption keys from existing ed25519 identity keys |

All functions are available in `sodium-native` (already a dependency). No new packages required.

---

## Key architecture

### Two-layer encryption

**Layer 1 — Symmetric secrets key (32 bytes, random, per repo)**
Used to encrypt and decrypt secret file content with `crypto_secretbox`. One key per repo, versioned. Never stored or transmitted in plaintext.

**Layer 2 — Key envelopes (one per writer per key version)**
The secrets key is encrypted individually to each writer using `crypto_box_seal` (ephemeral ECDH to their X25519 public key). Only the intended recipient can open their envelope. Envelopes are stored in the Autobase view and replicated to all peers — this is safe because they are individually encrypted.

### Why this split

| Concern | Handled by |
|---|---|
| Encrypting large files efficiently | Symmetric (`crypto_secretbox`) |
| Giving each writer their own access copy | Per-writer sealed box envelope |
| ACL-gated key distribution (only indexers issue envelopes) | Autobase ops + `apply()` signature check |
| Bulk content replication | `secrets/` Hyperbee (same pattern as object store) |

---

## The ed25519 → X25519 conversion

**Critical detail.** The existing identity keypairs are ed25519 (for signing). `crypto_box_seal` requires Curve25519 / X25519 keys. `sodium-native` provides lossless conversion:

```js
import sodium from 'sodium-native'

// From lib/secrets.js — these are the only two conversion calls needed

function deriveX25519Pub (ed25519Pub) {
  // ed25519Pub: 32-byte Buffer
  const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES) // 32 bytes
  sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, ed25519Pub)
  return x25519Pub
}

function deriveX25519Secret (ed25519Secret) {
  // ed25519Secret: 64-byte Buffer (sodium convention: secret = private || public)
  const x25519Secret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES) // 32 bytes
  sodium.crypto_sign_ed25519_sk_to_curve25519(x25519Secret, ed25519Secret)
  return x25519Secret
}
```

The ed25519 keys remain the canonical identity. X25519 keys are derived at runtime, never stored.

---

## `lib/secrets.js` API

```js
// Key derivation
deriveX25519Pub(ed25519Pub: Buffer): Buffer
deriveX25519Secret(ed25519Secret: Buffer): Buffer

// Key envelope operations (for key distribution via Autobase)
sealKey(secretsKey: Buffer, recipientEd25519Pub: Buffer): Buffer
  // → crypto_box_seal(secretsKey, deriveX25519Pub(recipientEd25519Pub))
  // Output: ~80 bytes (32 ephemeral pubkey + 32 secretsKey + 16 MAC)

openKey(envelope: Buffer, myEd25519Pub: Buffer, myEd25519Secret: Buffer): Buffer | null
  // → crypto_box_seal_open(envelope, deriveX25519Pub(myEd25519Pub), deriveX25519Secret(myEd25519Secret))
  // Returns null if decryption fails (not the intended recipient, or tampered)

// Secret file encryption
encryptFile(plaintext: Buffer, secretsKey: Buffer): { nonce: Buffer, ciphertext: Buffer }
  // nonce: 24 random bytes (crypto_secretbox_NONCEBYTES)
  // ciphertext: plaintext.length + 16 bytes (MAC)

decryptFile(nonce: Buffer, ciphertext: Buffer, secretsKey: Buffer): Buffer | null
  // Returns null if decryption fails (wrong key, tampered content)

// High-level: get this peer's secrets key from the Autobase view
getMySecretsKey(autobaseView: Hyperbee, identity: Identity): Promise<Buffer | null>
  // Reads 'secrets-key/<hex(identity.publicKey)>' from view
  // Calls openKey() with identity keypair
  // Returns null if no envelope found (peer not in writer set, or key not yet distributed)
```

---

## Storage

### Key envelopes — Autobase view (`view-secrets-keys`)

Populated by `apply()` when processing `secrets-key-envelope` ops. Never written directly.

| Hyperbee key | Value |
|---|---|
| `secrets-key-version` | `uint32 LE` — current key version (0 = no secrets key yet) |
| `secrets-key/<hex(writerPubKey)>` | `{ encryptedKey: Buffer, keyVersion: number }` |

### Secret file content — `secrets/` Hyperbee (`secrets/core`)

Written directly by `lib/secrets.js` (not via Autobase ops). Replicated to all peers via Hyperswarm — this is safe because all content is encrypted.

| Hyperbee key | Value format |
|---|---|
| `<path>` e.g. `.env` | `keyVersion(4 bytes LE) + nonce(24 bytes) + ciphertext` |

**Path validation:** must match `/^[\w.\-\/]+$/`, no `..` components, max 255 chars. Enforced before write.

---

## Key lifecycle

### On `pear-git init`
No secrets key created yet. `keyVersion = 0`. The key is created lazily on the first `pear-git secrets add`.

### On first `pear-git secrets add` (keyVersion = 0)
1. Generate a random 32-byte secrets key.
2. Append a `secrets-key-envelope` Autobase op for the creator (self).
3. Encrypt and store the secret file.
4. Key version becomes 1.

### On `pear-git invite <pubkey>` (when keyVersion > 0)
The inviting indexer must also issue a `secrets-key-envelope` op for the new writer. Flow:
1. `getMySecretsKey()` to retrieve the current secrets key.
2. If null (inviter doesn't have the key): warn user, proceed with `add-writer` op only. New writer won't be able to read secrets until an indexer with the key runs `pear-git secrets rotate`.
3. If found: append `secrets-key-envelope` op for the new writer alongside the `add-writer` op.

### On `pear-git secrets rotate` (indexer only)
1. Generate a new random 32-byte secrets key.
2. Read all current secret files from `secrets/` Hyperbee.
3. Decrypt each with the old key, re-encrypt with the new key, write back.
4. Append a `secrets-key-rotate` Autobase op (increments `keyVersion`).
5. Append a `secrets-key-envelope` op for every current writer.

### On `pear-git revoke <pubkey>`
The `remove-writer` op removes the peer from the Autobase writer set. Their key envelope remains in the view — they can still decrypt files encrypted before the rotation. **Prompt the user immediately:**
```
Warning: revoked writer retains read access to secrets encrypted before key rotation.
Run 'pear-git secrets rotate' to revoke their access to future secrets.
```

---

## Key version mismatch handling

When a writer reads a secret file, the stored `keyVersion` in the value must match the `keyVersion` of their envelope. If they differ:

| Situation | Cause | Action |
|---|---|---|
| File `keyVersion` > envelope `keyVersion` | Writer got a file but not yet their new envelope | Wait for envelope op to replicate; retry |
| File `keyVersion` < envelope `keyVersion` | Stale file not yet re-encrypted | Wait for rotation to complete; retry |
| No envelope found for this peer | Writer added but indexer couldn't distribute key | Ask an indexer to run `pear-git secrets rotate` |

---

## `.gitignore` note

Secret files managed by this system should **not** be committed to git. `pear-git init` adds the following to `.gitignore`:
```
.env
.env.*
*.pem
*.key
secrets/
```

The `pear-git secrets` system is the alternative to committing these files.

---

## Known limitations

- **No forward secrecy for revoked writers until rotation.** A revoked writer retains their old envelope. Run `pear-git secrets rotate` after every revocation.
- **Rotation is not atomic across the network.** Peers may temporarily see a mix of old and new key versions during rotation propagation. The `keyVersion` field in each file enables clients to detect and handle this correctly.
- **No per-file access control.** All writers share the same secrets key. Granular per-file ACLs are not supported in v1.
- **No secret history / audit log.** Last-write-wins per path. Previous versions of a secret are not retained.
