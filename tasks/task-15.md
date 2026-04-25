# Task 15: remote-helper.js — stdin/stdout git remote helper protocol

- **Agent:** `backend-dev`
- **Depends on:** Task 14, Task 11, Task 13
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/logging.md`

## Description

Implement `lib/remote-helper.js` so all tests in `test/remote-helper.test.js` pass. This module implements the git remote helper protocol over stdin/stdout. The most critical constraint: stdout is the protocol — any non-protocol byte written to stdout silently corrupts git. All logging MUST go to stderr (fd: 2).

## Files to create/modify

- `lib/remote-helper.js`

## Acceptance Criteria

- [x] `npm test -- --test-name-pattern remote-helper` passes all tests.
- [x] `createRemoteHelper(opts)` reads lines from `opts.input` and writes protocol responses to `opts.output`.
- [x] `capabilities` command responds with `fetch\npush\noption\n\n`.
- [x] `list` command reads all entries from `opts.repo.view` and outputs one `<sha> <refname>` line per ref, then a blank line.
- [x] `list` command outputs `@refs/heads/main HEAD\n` if `HEAD` is a symbolic ref (check if `HEAD` value starts with `@`).
- [x] `list` on an empty repo outputs just `\n`.
- [x] `option verbosity <n>` sets the pino log level (0→warn, 1→info, 2→debug) and responds `ok\n`.
- [x] `option progress <true|false>` enables/disables progress lines and responds `ok\n`.
- [x] Unknown `option` responds `unsupported\n`.
- [x] `push <src>:<dst>` handler: resolves src SHA in working clone, writes new objects to object store, appends ref-update op, responds `ok <dst>\n` or `error <dst> <reason>\n`.
- [x] `push` with leading `+` on src sets `force: true`.
- [x] `push` with empty src (`:refs/heads/dst`) calls delete path (append ref-update op with delete sentinel or null SHA).
- [x] After a successful push (all objects written, ref-update applied), an `objects-available` op is appended to the Autobase input core listing the new SHAs (max 256 per op; split into multiple ops if needed). This is a best-effort broadcast — failure to append does NOT cause the push to fail.
- [x] `fetch <sha> <refname>` handler: checks object store, decompresses objects, writes to working clone `.git/objects/`, recursively walks the object graph, responds with blank line on success.
- [x] Fetch `error <refname> object <sha> not found in swarm\n` on failure.
- [x] All log calls go to a pino logger configured with `destination: pino.destination({ fd: 2 })`.
- [x] Nothing non-protocol is written to `opts.output`.
- [x] Module exits or resolves the returned Promise when `opts.input` closes (stdin EOF from git).
- [x] Linter clean.

## Key implementation notes

### Line reading

```js
import { createInterface } from 'node:readline'

const rl = createInterface({ input: opts.input, crlfDelay: Infinity })

for await (const line of rl) {
  if (line === '') {
    // Blank line = batch boundary — process the current command batch
    await processBatch(currentBatch)
    currentBatch = []
  } else {
    currentBatch.push(line)
  }
}
```

### push — object walking

For each new SHA being pushed, recursively collect all reachable objects not yet in the object store:
1. Read the git object from the working clone's `.git/objects/` directory (loose object or pack — use `git cat-file -t <sha>` and `git cat-file -p <sha>` via `child_process.execFile` or read the loose object format directly).
2. For commit objects: add tree SHA and parent SHAs to the queue.
3. For tree objects: add all blob and subtree SHAs to the queue.
4. Skip SHAs already in the object store (`objectStore.has(sha)`).
5. For each new object: `objectStore.put(sha, objectBytes)`.

The simplest reliable approach for object reading is to invoke `git cat-file --batch` as a child process with the working clone as the working directory. This avoids reimplementing git's loose object format parser.

### fetch — writing objects

For each fetched object:
1. Get bytes from `objectStore.get(sha)` (returns decompressed canonical git object bytes).
2. Write to working clone as a loose object: the loose object file path is `.git/objects/<sha[0:2]>/<sha[2:]>`, and the content must be zlib-deflated (NOT gzip — git uses zlib/deflate, not gzip).
3. Walk the object graph recursively (same logic as push, but in reverse — read from object store, write to git).

Use `node:zlib` `deflate` (not `gzip`) for writing loose git objects:
```js
import { deflate } from 'node:zlib'
import { promisify } from 'node:util'
const deflateAsync = promisify(deflate)
```

### progress

Write progress lines to stderr (not opts.output):
```js
process.stderr.write(`Fetching objects: ${n}/${total}\n`)
```
Only write if progress is enabled (default: true; disabled by `option progress false`).

### objects-available broadcast (after push)

After writing all new objects and getting an `ok` back from the ref-update:

```js
// Split SHAs into chunks of 256 and append one op per chunk
for (let i = 0; i < newShas.length; i += 256) {
  const chunk = newShas.slice(i, i + 256)
  try {
    await repo.appendOp({ op: 'objects-available', shas: chunk })
  } catch (err) {
    log.warn({ err }, 'objects-available broadcast failed (non-fatal)')
  }
}
```

### Exit codes

When the helper returns an error, `createRemoteHelper` should resolve (not reject) and the bin entry point sets the exit code. Return the desired exit code as the resolved value, or use a structured result object.
