# Task 18: pear-git init subcommand

- **Agent:** `backend-dev`
- **Depends on:** Task 17, Task 13
- **Architecture files:** `architecture/protocols.md`, `architecture/cli-interface.md`, `architecture/project-structure.md`, `architecture/env-vars.md`, `architecture/auth.md`

## Description

Implement `pear-git init` and the `bin/pear-git` entry point skeleton. `init` creates a new Autobase-backed repo in the current directory, sets the `origin` remote to the `pear://` URL, writes a `.gitignore` with secret file patterns, and prints just the URL to stdout. This task also establishes the CLI argument parsing pattern used by all subsequent `pear-git` subcommands.

## Files to create/modify

- `bin/pear-git` — new file, executable, entry point with subcommand dispatch
- `lib/commands/init.js` — init logic (exported for testability)

## Acceptance Criteria

- [ ] `bin/pear-git` is executable with `#!/usr/bin/env node` shebang.
- [ ] `bin/pear-git` dispatches based on `process.argv[2]` to subcommand handlers.
- [ ] `node bin/pear-git init` in a directory with an existing git repo exits 0 and prints a `pear://` URL to stdout.
- [ ] Stdout contains ONLY the URL (nothing else — no trailing newline besides the URL's own `\n`).
- [ ] Stderr contains a human-readable progress message: `Repo created. Share this URL with collaborators.`
- [ ] `git remote get-url origin` in the repo directory returns the same URL.
- [ ] `.gitignore` is written with these patterns on separate lines: `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/`.
- [ ] If `.gitignore` already exists: append the patterns (do not overwrite the existing file).
- [ ] A Corestore is created at `path.join(dataDir, 'stores', base58RepoKey)`.
- [ ] The `pear://` URL encodes the Autobase's 32-byte key as a base58 string.
- [ ] Running `init` a second time in the same directory exits 1 with error message `pear-git: error: already a pear-git repo (origin is pear://...)`.
- [ ] `--name <alias>` flag is accepted and silently ignored (placeholder for future use).
- [ ] `PEAR_GIT_DATA_DIR` env var is respected for the data directory.
- [ ] Pino logger for the CLI uses `component: 'cli'`, logs to stderr.
- [ ] Linter clean.

## Key implementation notes

### Base58 encoding

**Resolved:** `pear://` URLs use **base58** (Bitcoin alphabet) via the `bs58` npm package. `bin/git-remote-pear` decodes with the same library.

```js
import bs58 from 'bs58'

const url = 'pear://' + bs58.encode(base.key)  // base.key is a 32-byte Buffer
```

Example output: `pear://gK3pQzM2...` (43–44 chars for a 32-byte key).

### git remote setup

```js
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)

await exec('git', ['remote', 'add', 'origin', url], { cwd })
```

### Check if already init'd

```js
try {
  const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd })
  if (stdout.trim().startsWith('pear://')) {
    process.stderr.write(`pear-git: error: already a pear-git repo (origin is ${stdout.trim()})\n`)
    process.exit(1)
  }
} catch { /* no origin set — proceed */ }
```

### .gitignore patterns

```js
const GITIGNORE_PATTERNS = ['.env', '.env.*', '*.pem', '*.key', 'secrets/']
```

Read existing `.gitignore` (if any), append missing patterns, write back.

### Subcommand dispatch skeleton (bin/pear-git)

```js
#!/usr/bin/env node
import { initRepo } from '../lib/commands/init.js'
// import other commands as tasks complete...

const sub = process.argv[2]
const args = process.argv.slice(3)

switch (sub) {
  case 'init':   await import('../lib/commands/init.js').then(m => m.run(args)); break
  // ... other subcommands added in later tasks
  default:
    process.stderr.write(`pear-git: unknown subcommand: ${sub}\n`)
    process.exit(1)
}
```
