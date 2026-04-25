# Task 24: pear-git status subcommand

- **Agent:** `backend-dev`
- **Depends on:** Task 23, Task 18
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`

## Description

Implement `pear-git status` so all tests in `test/pear-git-status.test.js` pass. This subcommand reads the current repo state from the Autobase view and the SwarmManager and displays it in either human-readable or JSON format. It must handle the case where the cwd is not a pear-git repo (exit 1) and where no peers are connected (exit 3 but still show local state).

## Files to create/modify

- `lib/commands/status.js`
- `bin/pear-git` — add `status` dispatch case

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern pear-git-status` passes all tests.
- [ ] `run` detects the repo key by reading `git remote get-url origin` in `opts.cwd` and parsing the `pear://` URL.
- [ ] If origin is not a `pear://` URL (or no origin): write error to stderr and exit 1.
- [ ] Opens the Corestore and Autobase for the repo.
- [ ] Queries `repo.getWriters()` to count total writers and indexers.
- [ ] Queries `repo.signedLength` and `repo.pendingLength` (or equivalent Autobase properties) for the signed/pending op counts.
- [ ] Queries the rejection log Hyperbee (`view-rejections`) to count rejected pushes.
- [ ] Queries `secretsView.get('secrets-key-version')` for the current key version.
- [ ] Counts secrets files by iterating `secretsFilesDb` (the secrets Hyperbee) — count entries.
- [ ] `peers` count comes from `swarm.connectedPeers(repoKey)`.
- [ ] Human output matches exactly the format in `architecture/cli-interface.md`.
- [ ] `--json` outputs a single JSON object with all required fields and exits 0.
- [ ] Exit code 3 when `peers === 0` (still prints state).
- [ ] Linter clean.

## Key implementation notes

### Detecting the repo

```js
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)

let repoUrl
try {
  const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: opts.cwd })
  repoUrl = stdout.trim()
} catch {
  process.stderr.write('pear-git: error: not inside a pear-git repo\n')
  process.exit(1)
}
if (!repoUrl.startsWith('pear://')) {
  process.stderr.write('pear-git: error: origin is not a pear:// URL\n')
  process.exit(1)
}
```

### Human output format (exact)

```
Repo:            pear://<key>
Peers:           <n> connected
Signed length:   <n> (stable)
Pending ops:     <n>
Rejected pushes: <n>
Writers:         <total> (<indexers> indexer)
Secrets:         key v<n>, <m> files
```

For `Signed length`, append `(stable)` if no pending ops, otherwise `(<n> pending)`.

### JSON output fields

```json
{
  "repoKey": "pear://...",
  "peers": 3,
  "signedLength": 42,
  "pendingOps": 1,
  "rejectedPushes": 0,
  "writers": 2,
  "indexers": 1,
  "secrets": { "keyVersion": 2, "fileCount": 3, "hasKey": true }
}
```

### Autobase stats

Check the Autobase API for `base.signedLength` and pending op count. The Autobase view Hyperbee may have a `core.length` that reflects total applied ops — compare with `base.view.core.signedLength` if available.
