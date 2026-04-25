# Auth

gittorrent has no passwords, sessions, or tokens. Auth is based entirely on **ed25519 keypairs** and **Autobase's writer ACL**.

---

## Identity

Each user has one ed25519 keypair stored at `$PEAR_GIT_DATA_DIR/identity` (default: `~/.pear-git/identity`). Managed by `lib/identity.js`.

```json
{
  "publicKey": "<64-char hex>",
  "secretKey": "<128-char hex>",
  "createdAt": "<ISO 8601>"
}
```

- File mode must be `0600`. `identity.js` creates it this way and warns if it finds different permissions.
- The `secretKey` never leaves `identity.js`. It is used to sign ops; the signature (not the key) is what travels across the network.
- The `publicKey` is the user's permanent identity. It is what gets added to the writer ACL via `pear-git invite`.
- For secrets encryption, `lib/secrets.js` derives a **X25519 key pair** from the ed25519 keys at runtime using `sodium-native` conversion functions. The X25519 keys are never stored — they are derived on demand.

---

## Writer ACL

Autobase maintains the set of valid writer pubkeys. Only ops originating from a known writer's input core are processed. Outsiders' ops are ignored automatically — there is no "writer" core for them in the Corestore.

Two roles exist:

| Role | Push ref updates | Read/write secrets | Manage writers (add/remove) | Issue secrets key envelopes | Sign checkpoints (`signedLength`) |
|---|---|---|---|---|---|
| **indexer** | yes | yes | yes | yes | yes |
| **writer** (non-indexer) | yes | yes | no | no | no |

A repo always starts with one indexer: the creator. More indexers can be added via `pear-git invite <pubkey> --indexer`.

---

## ACL enforcement in `apply()`

All enforcement happens inside the deterministic Autobase `apply()` function in `lib/autobase-repo.js`. Because Autobase replays this function on causal reorder, enforcement is always consistent.

**`ref-update` ops:**
1. Verify `op.signature` against `node.from.key` (the writer's pubkey as recorded by Autobase).
2. If signature invalid → drop op, emit rejection log entry with `reason: 'invalid-signature'`.
3. If writer not in ACL → should not occur (Autobase filters input cores), but guard anyway.
4. Apply fast-forward check (see `data-models.md`).

**`add-writer` / `remove-writer` ops:**
1. Verify `op.signature` against the signing key.
2. Confirm signer is a current indexer by checking Autobase's writer list. If not → drop.
3. For `remove-writer`: Autobase enforces the last-indexer invariant natively. Also guard in `apply()`.
4. Call `host.addWriter(op.key, { indexer })` or `host.removeWriter(op.key)`.

**`secrets-key-envelope` ops:**
1. Verify `op.signature` is from an existing indexer. If not → drop.
2. Verify `op.keyVersion` matches current version in view. If not → drop.
3. Write `view-secrets-keys` entry for the recipient.

**`secrets-key-rotate` ops:**
1. Verify `op.signature` is from an existing indexer. If not → drop.
2. Verify `op.newKeyVersion === currentKeyVersion + 1`. If not → drop.
3. Increment `secrets-key-version` in view.

**Optimistic writers (not yet in ACL):**
Autobase supports an `optimistic` mode where ops from unknown writers are held pending an indexer's `ackWriter`. This is the natural primitive for a "submit a PR" flow (stretch goal): a non-writer submits ref ops that an indexer reviews and approves.

---

## Repo identity and key derivation

A repo is identified by the **public key of its Autobase**. The Autobase key is derived from the bootstrap writer's keypair on `pear-git init`. The `pear://` URL embeds this key in base58:

```
pear://<base58-autobase-public-key>
```

After bootstrap, the Autobase key is stable regardless of which writers come and go. The repo identity never changes even if the creator's machine is destroyed.

---

## Protected operations summary

| Operation | Who can perform |
|---|---|
| `git push` (any ref) | Any writer (indexer or non-indexer) |
| `pear-git secrets add` / `get` / `list` / `rm` | Any writer with a valid key envelope |
| `pear-git invite` | Indexers only |
| `pear-git revoke` | Indexers only |
| `pear-git secrets rotate` | Indexers only |
| Issue a `secrets-key-envelope` op | Indexers only |
| Remove the last indexer | Nobody (refused by Autobase + `apply()` guard) |
| Sign a checkpoint (`signedLength` advance) | Indexers only (automatic via Autobase) |

---

## What auth does NOT cover

- Commit content. Anyone in the writer set can push any commit. Same trust model as GitHub with direct push access.
- Byzantine resistance. We assume writers are cooperating humans, not adversaries.
- Sybil resistance. The writer ACL is explicit; the swarm is not open-write.
- Per-file secret ACLs. All writers share one secrets key. Granular access control is not in scope for v1.
- Forward secrecy for secrets without explicit rotation. Revoking a writer without running `pear-git secrets rotate` leaves them able to decrypt files encrypted before the rotation.
