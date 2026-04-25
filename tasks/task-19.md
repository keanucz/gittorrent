# Task 19: Tests for pear-git invite and revoke

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 11
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/auth.md`, `architecture/secrets.md`

## Description

Write failing unit tests for `pear-git invite` and `pear-git revoke` before they are implemented. These subcommands manage the Autobase writer ACL. Tests must cover ACL enforcement (indexer-only), the `--indexer` flag, the secrets key envelope distribution on invite, the revocation warning about secrets, and all exit code paths.

## Files to create

- `test/pear-git-invite.test.js`

## What will be tested

```js
// lib/commands/invite.js
export async function run(args: string[], opts: { dataDir, cwd }): Promise<void>
// args: ['<64-char-hex-pubkey>', '--indexer'?]

// lib/commands/revoke.js
export async function run(args: string[], opts: { dataDir, cwd }): Promise<void>
// args: ['<64-char-hex-pubkey>']
```

## Acceptance Criteria

- [ ] `test/pear-git-invite.test.js` exists and fails when the invite/revoke commands do not exist.

### invite tests

- [ ] Test: `invite <pubkey>` by an indexer succeeds (exit 0), stdout contains `Invited <pubkey-short> (indexer: no)`.
- [ ] Test: `invite <pubkey> --indexer` stdout contains `(indexer: yes)`.
- [ ] Test: `invite <pubkey>` where caller is NOT an indexer exits 2 with error `not an indexer — cannot invite writers`.
- [ ] Test: `invite <pubkey>` where pubkey is already a writer exits 2 with error about already being a writer.
- [ ] Test: `invite` with an invalid hex pubkey (wrong length or non-hex) exits 2 with a clear parse error.
- [ ] Test: when `keyVersion > 0` (secrets key exists) and the inviter has the key, a `secrets-key-envelope` op is emitted for the new writer (mock the repo and check the call was made).
- [ ] Test: when inviter does not have the secrets key, a warning is printed to stderr about the key not being distributable, but the command still exits 0.

### revoke tests

- [ ] Test: `revoke <pubkey>` by an indexer succeeds (exit 0), stdout contains `Revoked <pubkey-short>`.
- [ ] Test: `revoke <pubkey>` always prints the secrets rotation warning to stderr (even if no secrets key exists — warn anyway to prompt the user to check).
- [ ] Test: `revoke` by a non-indexer exits 2.
- [ ] Test: `revoke` of a non-writer pubkey exits 2 with appropriate error.
- [ ] Test: `revoke` of the last indexer exits 2 with appropriate error.
- [ ] Test: `revoke` with an invalid hex pubkey exits 2.
- [ ] All tests mock the Repo and secrets modules — no real Autobase or disk I/O.
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

For these tests, mock the repo using a plain object:

```js
const repoMock = {
  addWriter: async (key, opts) => { /* record call */ },
  removeWriter: async (key) => { /* record call */ },
  getWriters: async () => [{ key: identityPubkey, indexer: true }],
  // simulate indexer check:
  isIndexer: async (pubkey) => pubkey.equals(identityPubkey)
}
```

Capture stdout/stderr by temporarily replacing `process.stdout.write` and `process.stderr.write`, or by having the command functions accept output stream parameters.

For "invalid hex pubkey" test:
```js
const INVALID = 'not-hex-at-all'
const SHORT = 'aabb'
```

For "secrets key envelope" test, mock `getMySecretsKey` from secrets.js to return a 32-byte Buffer, and assert that a corresponding `addWriter`+`secretsKeyEnvelope` call pair was made.
