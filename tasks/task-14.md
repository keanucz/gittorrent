# Task 14: Tests for remote-helper.js

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 03
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/logging.md`

## Description

Write failing unit tests for `lib/remote-helper.js` before the module exists. The remote helper reads git commands line-by-line from stdin and writes protocol responses to stdout. Tests must cover all four commands (`capabilities`, `list`, `fetch`, `push`), the `option` command, correct blank-line batch termination, error formatting, and the critical constraint that no non-protocol bytes touch stdout.

## Files to create

- `test/remote-helper.test.js`

## What remote-helper.js will export

```js
// Create a remote helper instance attached to specified streams
// (default: process.stdin, process.stdout, but testable with any Duplex/Readable/Writable)
export async function createRemoteHelper(opts: {
  input: Readable,
  output: Writable,
  repo: Repo,           // autobase-repo.js Repo object
  objectStore: ObjectStore,
  workingClonePath: string,  // path to the working git clone's .git directory
  identity: Identity
}): Promise<void>  // resolves when the helper session ends (stdin closes)
```

## Acceptance Criteria

- [ ] `test/remote-helper.test.js` exists and fails when `lib/remote-helper.js` does not exist.
- [ ] Test helper: a `createTestSession` function that pipes strings to a mock input stream and captures stdout to a string.
- [ ] Test: sending `capabilities\n\n` produces stdout `fetch\npush\noption\n\n`.
- [ ] Test: sending `list\n\n` on an empty repo produces stdout `\n` (single blank line).
- [ ] Test: sending `list\n\n` on a repo with one ref produces `<sha> <refname>\n\n`.
- [ ] Test: `list` includes `@refs/heads/main HEAD\n` when a symbolic HEAD exists.
- [ ] Test: sending `option verbosity 1\n\n` produces `ok\n`.
- [ ] Test: sending `option unknown-option value\n\n` produces `unsupported\n`.
- [ ] Test: sending `option verbosity 0\n\n` sets log level to `warn` (verify via a debug-level log NOT appearing).
- [ ] Test: push `ok` response — `push refs/heads/main:refs/heads/main\n\n` on success produces `ok refs/heads/main\n\n`.
- [ ] Test: push `error` response — when `updateRef` returns `{ ok: false, reason: 'non-fast-forward' }`, produces `error refs/heads/main non-fast-forward\n\n`.
- [ ] Test: push with force flag (`+refs/heads/main:refs/heads/main`) sets `force: true` in the `updateRef` call.
- [ ] Test: push with empty src (`:refs/heads/main`) means delete — verify the delete path is called (mock the repo).
- [ ] Test: nothing non-protocol is written to `output` (stdout) — verify by capturing all output bytes.
- [ ] Test: error response format — `error refs/heads/main <message>\n`.
- [ ] All tests mock `repo`, `objectStore`, and git operations — do not invoke real git or Autobase.
- [ ] All tests use `node:test` and `node:assert/strict`.

## Testing requirements

Use `node:stream` to create in-memory streams:

```js
import { PassThrough } from 'node:stream'

function createTestSession (repoMock, objectStoreMock) {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks = []
  output.on('data', chunk => chunks.push(chunk))
  
  const sessionDone = createRemoteHelper({
    input,
    output,
    repo: repoMock,
    objectStore: objectStoreMock,
    workingClonePath: '/tmp/fake',
    identity: mockIdentity
  })
  
  return {
    send: (str) => input.push(str),
    end: () => input.push(null),
    getOutput: () => Buffer.concat(chunks).toString(),
    sessionDone
  }
}
```

Minimal repo mock for the `list` tests:
```js
const repoMock = {
  view: {
    createReadStream: () => /* async generator of { key, value } entries */ ...
  },
  getRef: async (ref) => null
}
```

Minimal repo mock for push tests:
```js
const repoMock = {
  updateRef: async (ref, oldSha, newSha, force) => ({ ok: true })
}
```

For object transfer tests (fetch and push), stub `objectStore.has` and `objectStore.put` — do not actually invoke git. The object graph walking logic can be tested at a higher level in the e2e test.
