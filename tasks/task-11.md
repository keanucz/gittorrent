# Task 11: autobase-repo.js — Autobase wrapper and deterministic apply()

- **Agent:** `backend-dev`
- **Depends on:** Task 10, Task 07, Task 09
- **Architecture files:** `architecture/data-models.md`, `architecture/auth.md`, `architecture/security.md`, `architecture/logging.md`, `architecture/external-deps.md`

## Description

Implement `lib/autobase-repo.js` so all tests in `test/autobase-repo.test.js` pass. This is the architectural centrepiece: it wraps Autobase with the deterministic `apply()` function that enforces the ACL, validates signatures, and mutates the ref view. Read the Autobase DESIGN.md before implementing — the apply function's reordering semantics are critical.

## Files to create/modify

- `lib/autobase-repo.js`

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern autobase-repo` passes all tests.
- [ ] `openRepo(corestore, identity, opts)` creates/opens an Autobase with the identity's keypair as the bootstrap writer.
- [ ] The Autobase view is a Hyperbee (`view-refs`) storing ref → sha mappings.
- [ ] A second Hyperbee (`view-secrets-keys`) stores secrets key envelopes.
- [ ] A third Hyperbee (`view-rejections`) records rejected ref-update ops.
- [ ] `apply(nodes, view, host)` is deterministic: no clocks, no network, no random calls.
- [ ] `apply` dispatches to per-op handlers based on the `op` discriminant field decoded via `opCodec`.
- [ ] `ref-update` handler verifies the signature (`sodium.crypto_sign_verify_detached`) against `node.from.key`. Invalid signature → drop + write rejection log entry with `reason: 'invalid-signature'`.
- [ ] `ref-update` handler reads current value from `view`, checks fast-forward (unless `force: true`). Non-fast-forward → drop + write rejection log entry with `reason: 'non-fast-forward'`.
- [ ] `ref-update` handler calls `view.put(op.ref, op.newSha)` on success.
- [ ] `add-writer` handler verifies the signer is an existing indexer. Invalid → drop.
- [ ] `add-writer` handler calls `host.addWriter(op.key, { indexer: op.indexer })` on success.
- [ ] `remove-writer` handler verifies the signer is an existing indexer. Invalid → drop.
- [ ] `remove-writer` handler guards against removing the last indexer. If last indexer → drop + log warn.
- [ ] `remove-writer` calls `host.removeWriter(op.key)` on success.
- [ ] `objects-available` handler is a no-op (no view mutation).
- [ ] `secrets-key-envelope` handler verifies indexer signature, verifies keyVersion, writes to `view-secrets-keys`.
- [ ] `secrets-key-rotate` handler verifies indexer signature, verifies `newKeyVersion === currentVersion + 1`, increments version in `view-secrets-keys`.
- [ ] `updateRef` method signs the op with the identity's `sign()` method and appends to the Autobase input core using `opCodec`.
- [ ] `updateRef` waits for the op to appear in the view (or rejection log) before returning.
- [ ] `addWriter` method signs the op and appends to the input core.
- [ ] `removeWriter` method signs the op and appends to the input core.
- [ ] Pino child logger `component: 'autobase-repo'`. Log fields: `repoKey`, `opSeq`, `ref`, `writerKey` where applicable.
- [ ] Linter clean.

## Key implementation notes

### Autobase setup

```js
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'

const base = new Autobase(corestore, null, {
  apply,
  open (store) {
    // Returns the Hyperbee view
    const core = store.get('view-refs')
    return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
  },
  valueEncoding: 'binary'  // ops are binary (compact-encoding)
})
await base.ready()
```

The Autobase bootstrap call with `null` for the second arg means this is a new autobase using the corestore's default namespace. Study the Autobase API to determine if a key should be passed for opening an existing repo vs creating a new one.

### apply() signature

```js
async function apply (nodes, view, host) {
  for (const node of nodes) {
    const op = opCodec.decode(node.value)  // or c.decode(opCodec, node.value)
    await applyOp(op, node, view, host)
  }
}
```

### Autobase version

Use **`autobase@^6`** (the v6 API — do not use v5 or older). In Autobase v6:
- `apply(nodes, view, host)` — `nodes` is an array of linearised node objects.
- Each node: `node.value` (Buffer — the encoded op), `node.from` (the Hypercore of the writer who appended it), `node.from.key` (32-byte Buffer — the writer's public key).
- `host.system` — the Autobase system core. Use `host.system.writers` to enumerate current writers; each writer entry has `.key` (Buffer) and `.isIndexer` (boolean). Verify exact field names against the installed package's source / DESIGN.md since they may differ slightly.
- `host.addWriter(key, { indexer })` / `host.removeWriter(key)` — available in apply().

### Verifying indexer status in apply()

```js
async function isIndexer (host, pubkey) {
  // Autobase v6: iterate writers from the system core
  for await (const writer of host.system.writers) {
    if (writer.key.equals(pubkey) && writer.isIndexer) return true
  }
  return false
}
```

If the exact field names differ, consult `node_modules/autobase/lib/system.js` after `npm install`.

### Waiting for view update after append

After appending an op, call `await base.update()` to drain the apply queue. Then read from the view to check success or rejection.

### Multiple Hyperbee views

The view returned from `open()` is the primary ref view. To attach additional Hyperbee views (`view-secrets-keys`, `view-rejections`), use sub-databases: `view.sub('secrets-keys')` or a separate Hyperbee on a named core from the same Corestore namespace. Choose the approach that keeps the `apply()` function receiving a single `view` parameter — use `view.sub('...')` calls inside `apply` to access sub-trees.

### Op appending

```js
import c from 'compact-encoding'
import { opCodec } from './codec.js'

const encoded = c.encode(opCodec, op)
await base.append(encoded)
```
