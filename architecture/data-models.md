# Data Models

All ops are encoded with `compact-encoding` (see `lib/codec.js`) and appended to a writer's Hypercore input core. The Autobase `apply()` function in `lib/autobase-repo.js` processes them in linearised causal order.

**Critical constraint:** The `apply()` function must be deterministic and side-effect-free. It reads only from the Autobase `view` and `host`. No clocks, no network calls, no random values. Autobase will replay it on reorder.

---

## Op: `ref-update`

Appended to a writer's input core when they push a ref change.

```js
{
  op: 'ref-update',         // string literal — discriminant field

  ref: string,              // Git ref name. Must match /^refs\/[\w\/\-.]+$/ or equal 'HEAD'.
                            // Examples: 'refs/heads/main', 'refs/tags/v1.0.0', 'HEAD'

  oldSha: string | null,    // 40-char lowercase hex SHA the writer expected to be current.
                            // null means "I expect this ref not to exist yet" (new branch).
                            // Used for fast-forward enforcement in apply().

  newSha: string,           // 40-char lowercase hex SHA to set the ref to.
                            // Must match /^[0-9a-f]{40}$/.

  force: boolean,           // If true, skip fast-forward check. Allowed only for writers;
                            // still requires a valid signature.

  signature: Buffer,        // ed25519 signature (64 bytes) over the canonical encoding of
                            // { op, ref, oldSha, newSha, force } — signed with the writer's
                            // identity secret key. Verified in apply() against node.from.key.

  timestamp: number         // Unix milliseconds. Informational only — NOT used for ordering.
                            // Autobase causal order is authoritative.
}
```

**apply() logic for `ref-update`:**
1. Verify `signature` against `node.from.key`. If invalid: drop silently, log warn.
2. Read `current = await view.get(op.ref)`.
3. If `!op.force` and `current?.value !== op.oldSha`: conflict. Append to rejection log; continue.
4. `await view.put(op.ref, op.newSha)`.

---

## Op: `add-writer`

Appended by an indexer to grant write access to a new peer.

```js
{
  op: 'add-writer',

  key: Buffer,              // 32-byte ed25519 public key of the new writer.

  indexer: boolean,         // If true, new writer becomes an indexer (can sign checkpoints,
                            // can manage the writer set). If false: write-only.

  signature: Buffer         // 64-byte ed25519 signature over { op, key, indexer }.
                            // Must be signed by an existing indexer.
                            // Verified in apply() — if signer is not an indexer: drop.
}
```

**apply() logic for `add-writer`:**
1. Verify `signature` is from an existing indexer (`verifyAdminSig`). If not: drop.
2. `await host.addWriter(op.key, { indexer: op.indexer })`.

---

## Op: `remove-writer`

Appended by an indexer to revoke write access.

```js
{
  op: 'remove-writer',

  key: Buffer,              // 32-byte ed25519 public key of the writer to remove.

  signature: Buffer         // 64-byte ed25519 signature over { op, key }.
                            // Must be signed by an existing indexer.
}
```

**apply() logic for `remove-writer`:**
1. Verify `signature` is from an existing indexer. If not: drop.
2. Guard: if `op.key` is the last indexer, drop and log warn. (Autobase also enforces this.)
3. `await host.removeWriter(op.key)`.

---

## Op: `objects-available`

Informational broadcast. No view mutation. Helps peers know who has which objects without fetching them.

```js
{
  op: 'objects-available',

  shas: string[]            // Array of 40-char hex SHAs. Max 256 entries per op.
                            // Each must match /^[0-9a-f]{40}$/.
}
```

**apply() logic:** No-op w.r.t. view. May be used by `object-store.js` to prioritise which peers to replicate from.

---

## Op: `secrets-key-envelope`

Appended by an indexer to distribute the encrypted secrets key to a specific writer. Issued when a writer is added (if a secrets key already exists) or during key rotation. One envelope per writer per key version.

```js
{
  op: 'secrets-key-envelope',

  recipientKey: Buffer,     // 32-byte ed25519 public key of the intended recipient.

  encryptedKey: Buffer,     // crypto_box_seal(secretsKey, recipientX25519Pub)
                            // ~80 bytes: 32-byte ephemeral pubkey + 32-byte secretsKey + 16-byte MAC.
                            // Only the recipient can open this (ECIES sealed box).

  keyVersion: number,       // Monotonic uint32. Incremented on every rotation.
                            // First secrets key = version 1.

  signature: Buffer         // 64-byte ed25519 signature over { op, recipientKey, encryptedKey, keyVersion }.
                            // Must be signed by an existing indexer.
}
```

**apply() logic for `secrets-key-envelope`:**
1. Verify `signature` is from an existing indexer. If not: drop.
2. Verify `op.keyVersion` matches current `secrets-key-version` in view (or is exactly 1 if version is 0). If not: drop.
3. `await view.put('secrets-key/' + op.recipientKey.toString('hex'), { encryptedKey: op.encryptedKey, keyVersion: op.keyVersion })`.

See `architecture/secrets.md` for the full key lifecycle.

---

## Op: `secrets-key-rotate`

Appended by an indexer to signal a key rotation. Must be followed (in the same batch of ops) by new `secrets-key-envelope` ops for all current writers.

```js
{
  op: 'secrets-key-rotate',

  newKeyVersion: number,    // Must equal currentKeyVersion + 1. Validated in apply().

  signature: Buffer         // 64-byte ed25519 signature over { op, newKeyVersion }.
                            // Must be signed by an existing indexer.
}
```

**apply() logic for `secrets-key-rotate`:**
1. Verify `signature` is from an existing indexer. If not: drop.
2. Read `currentVersion = await view.get('secrets-key-version')`. If `op.newKeyVersion !== currentVersion + 1`: drop (out-of-order or duplicate).
3. `await view.put('secrets-key-version', op.newKeyVersion)`.

---

## Ref View entry

Stored in the Autobase-derived Hyperbee (`view-refs`). Updated exclusively by `apply()`.

| Field | Type | Notes |
|---|---|---|
| Key | `string` | Git ref name. E.g. `refs/heads/main`, `HEAD`. Same constraints as `op.ref`. |
| Value | `string` | 40-char lowercase hex SHA. |

Enumerated in full by `git-remote-pear` on `list` command to report all refs to git.

---

## Secrets Key View entries

Stored in the Autobase-derived Hyperbee (`view-secrets-keys`). Updated exclusively by `apply()`.

| Hyperbee key | Value type | Notes |
|---|---|---|
| `secrets-key-version` | `number` (uint32) | Current key version. 0 = no secrets key yet. |
| `secrets-key/<hex(writerPubKey)>` | `{ encryptedKey: Buffer, keyVersion: number }` | One entry per writer. Encrypted to that writer's X25519 key. |

---

## Object Store entry

Stored in the shared Hyperbee (`objects/core`). Written by any peer when they create new git objects. Replicated across the swarm via Hyperswarm.

| Field | Type | Notes |
|---|---|---|
| Key | `string` | 40-char lowercase hex SHA of the git object. Must match `/^[0-9a-f]{40}$/`. |
| Value | `Buffer` | `gzip(canonical git object bytes)`. Canonical format = type header + NUL + content, exactly as git stores loose objects. |

No conflict possible: SHA is derived from content. Two peers writing the same SHA always write identical bytes.

---

## Secret File entry

Stored in the shared Hyperbee (`secrets/core`). Written directly by `lib/secrets.js` (not via Autobase). Replicated to all peers via Hyperswarm — safe because content is always encrypted.

| Field | Type | Notes |
|---|---|---|
| Key | `string` | File path. Must match `/^[\w.\-\/]+$/`. No `..` components. Max 255 chars. E.g. `.env`, `config/api.json`. |
| Value | `Buffer` | `keyVersion(4 bytes LE uint32) + nonce(24 bytes) + ciphertext(variable)`. Ciphertext = `crypto_secretbox(plaintext, nonce, secretsKey)`. |

On read: extract `keyVersion`, find matching envelope in `view-secrets-keys`, decrypt envelope to get `secretsKey`, decrypt content. See `architecture/secrets.md` for full decrypt flow and key version mismatch handling.

---

## Identity file

Stored at `$PEAR_GIT_DATA_DIR/identity`. File mode `0600`. Created by `lib/identity.js` on first use.

```js
{
  publicKey: string,    // 64-char hex (32 bytes). Safe to share; used as the writer's identity.
  secretKey: string,    // 128-char hex (64 bytes). NEVER logged, NEVER exported, NEVER in ops.
  createdAt: string     // ISO 8601 timestamp of key generation.
}
```

**Validation on load:**
- Both keys present and correct hex length.
- File mode is `0600`; warn (don't error) if not.
- `secretKey` must not appear in any log output — see `architecture/logging.md`.

---

## Rejection log entry

A separate Hyperbee view (`view-rejections`) populated by `apply()` when a `ref-update` is rejected. Read by `pear-git status`.

```js
{
  seq: number,          // Autobase sequence number of the rejected op.
  ref: string,          // The ref that was rejected.
  reason: string,       // 'non-fast-forward' | 'invalid-signature' | 'not-a-writer'
  writerKey: string,    // hex pubkey of the writer who submitted the op.
  timestamp: number     // From the original op.
}
```
