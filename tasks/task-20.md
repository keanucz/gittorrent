# Task 20: pear-git invite and revoke subcommands

- **Agent:** `backend-dev`
- **Depends on:** Task 19, Task 18, Task 09
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/auth.md`, `architecture/secrets.md`

## Description

Implement `pear-git invite` and `pear-git revoke` subcommands, wiring the Autobase ACL management ops and secrets key envelope distribution. Both subcommands are indexer-only operations. `invite` must also distribute the current secrets key to the new writer if one exists.

## Files to create/modify

- `lib/commands/invite.js` — invite and revoke logic
- `bin/pear-git` — add `invite` and `revoke` dispatch cases

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern pear-git-invite` passes all tests.
- [ ] `invite <pubkey>` validates the pubkey as a 64-char hex string before calling any repo method.
- [ ] `invite <pubkey>` calls `repo.addWriter(pubkey, { indexer: false })` by default.
- [ ] `invite <pubkey> --indexer` calls `repo.addWriter(pubkey, { indexer: true })`.
- [ ] `invite` checks that the caller is an indexer (via `repo.getWriters()`); if not, exits 2.
- [ ] `invite` checks that the pubkey is not already a writer; if already a writer, exits 2.
- [ ] When `keyVersion > 0` and caller has the secrets key: appends a `secrets-key-envelope` op for the new writer (via `repo.appendSecretsEnvelope(newWriterPubkey, encryptedKey, keyVersion)`).
- [ ] When caller lacks the secrets key: prints the warning to stderr and proceeds with `add-writer` only.
- [ ] `invite` stdout: `Invited <first-8-chars-of-pubkey>... (indexer: yes|no)`.
- [ ] `revoke <pubkey>` validates the pubkey.
- [ ] `revoke` checks the caller is an indexer; if not, exits 2.
- [ ] `revoke` checks the target is a writer; if not, exits 2.
- [ ] `revoke` calls `repo.removeWriter(pubkey)` which will fail for last indexer.
- [ ] `revoke` always prints the secrets rotation warning to stderr.
- [ ] `revoke` stdout: `Revoked <pubkey-short>`.
- [ ] All operations are logged via pino `component: 'cli'`.
- [ ] Linter clean.

## Key implementation notes

### Pubkey validation

```js
const PUBKEY_RE = /^[0-9a-f]{64}$/

function validatePubkey (str) {
  if (!PUBKEY_RE.test(str)) {
    process.stderr.write(`pear-git: error: invalid public key (expected 64-char hex)\n`)
    process.exit(2)
  }
  return Buffer.from(str, 'hex')
}
```

### Checking caller is an indexer

```js
const writers = await repo.getWriters()
const me = writers.find(w => w.key.equals(identity.publicKey))
if (!me || !me.indexer) {
  process.stderr.write('pear-git: error: not an indexer — cannot invite writers\n')
  process.exit(2)
}
```

### Secrets key envelope on invite

```js
import { getMySecretsKey, sealKey } from '../secrets.js'

const secretsKey = await getMySecretsKey(repo.secretsView, identity.publicKey, secretKeyBuffer)
if (secretsKey) {
  const currentVersion = (await repo.secretsView.get('secrets-key-version'))?.value ?? 0
  const encryptedKey = sealKey(secretsKey, newWriterPubkey)
  await repo.appendOp({
    op: 'secrets-key-envelope',
    recipientKey: newWriterPubkey,
    encryptedKey,
    keyVersion: currentVersion,
    signature: identity.sign(/* canonical encoding of the above fields */)
  })
} else {
  process.stderr.write('warning: could not distribute secrets key ...\n')
}
```

### Revoke warning message (exact text)

```
warning: revoked writer retains read access to secrets encrypted before key rotation.
Run 'pear-git secrets rotate' to revoke their access.
```

### Signing ops

For `add-writer` and `remove-writer`, the Repo's `addWriter`/`removeWriter` methods handle signing internally (using the identity passed at `openRepo` time). Do not sign manually in the command layer — delegate to the Repo methods.
