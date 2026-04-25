# Protocols

This project has no HTTP API. Two protocol surfaces exist:

- **A. git remote helper** — stdin/stdout line protocol between git and `git-remote-pear`
- **B. pear-git CLI** — user-facing subcommands with defined args, output, and exit codes

---

## A. git remote helper protocol

### Overview

When git encounters a `pear://` URL it looks for an executable named `git-remote-pear` on `$PATH` and invokes it as:

```
git-remote-pear <remote-name> <pear-url>
```

Git communicates with the helper via **stdin (commands → helper)** and **stdout (responses → git)**. The protocol is line-oriented text. Commands end with a blank line to signal a batch boundary.

**Critical:** stdout is exclusively the protocol. Any non-protocol bytes on stdout will silently corrupt git. All logging goes to **stderr only**. See `architecture/logging.md`.

---

### Command reference

#### `capabilities`

Git always sends this first.

**Request (stdin):**
```
capabilities

```
(note: blank line terminates the command)

**Response (stdout):**
```
fetch
push
option

```

---

#### `list`

Enumerate all refs in the repo. Git calls this before fetch and push.

**Request (stdin):**
```
list

```

or, before a push:
```
list for-push

```

**Response (stdout):** One line per ref, then a blank line.
```
<sha> <refname>
<sha> <refname>
...

```

Example:
```
abc123...def456 refs/heads/main
111aaa...222bbb refs/heads/feature-x
@refs/heads/main HEAD

```

The `@<target> HEAD` form is used for symbolic refs (HEAD pointing to a branch).

**Implementation:** Read all entries from the Autobase view Hyperbee (`view-refs`). If the repo has no refs yet (empty repo), respond with just a blank line.

**Error (stdout):**
```
error refs <human-readable message>

```

Exit with code 1.

---

#### `fetch`

Git requests one or more objects by SHA.

**Request (stdin):** One or more fetch lines, terminated by a blank line.
```
fetch <sha> <refname>
fetch <sha> <refname>
...

```

**Response (stdout):** A single blank line when all objects are locally available.
```

```

**Implementation:**
1. For each requested SHA, check if the object is in the local working clone's object store.
2. If missing, fetch from the shared Hyperbee object store (sparse replication triggers automatically).
3. Decompress (gunzip) and write as a loose object into `working-clone/.git/objects/`.
4. Recursively walk the object graph (commits → trees → blobs) to ensure all reachable objects are present.
5. Respond with blank line when complete.

**Error (stdout):**
```
error <refname> object <sha> not found in swarm

```

Exit with code 1.

---

#### `push`

Push one or more ref updates.

**Request (stdin):** One or more push lines, terminated by a blank line.
```
push <src>:<dst>
push <src>:<dst>
...

```

- `<src>` is the local ref or SHA to push. If `<src>` is empty (`:refs/heads/branch`) it means delete the ref.
- `<dst>` is the remote ref name.
- A leading `+` on `<src>` means force push: `+refs/heads/main:refs/heads/main`.

**Response (stdout):** One result line per ref, then a blank line.
```
ok <dst>
```
or
```
error <dst> <human-readable message>
```

Example success:
```
ok refs/heads/main

```

Example conflict:
```
error refs/heads/main non-fast-forward

```

**Implementation:**
1. Resolve `<src>` to a SHA in the working clone.
2. Walk all new objects reachable from `<src>` that are not already in the shared object store. Write each to the Hyperbee object store (gzip-compressed).
3. Append a `ref-update` op to this peer's Autobase input core:
   - `oldSha` = current value from the Autobase view (or null if new ref)
   - `force` = true if `<src>` had a leading `+`
4. Wait for the op to be applied to the local view (or for a rejection to appear in the rejection log).
5. Respond `ok <dst>` or `error <dst> <reason>`.

---

#### `option`

Git may send option commands to configure behaviour.

**Request (stdin):**
```
option <name> <value>

```

**Response (stdout):**
```
ok
```
or, if unsupported:
```
unsupported
```

Supported options:

| Option | Values | Behaviour |
|---|---|---|
| `verbosity` | `0`–`2` | Maps to log level: 0=warn, 1=info, 2=debug |
| `progress` | `true` / `false` | Enable/disable progress lines on stderr |

All other options: respond `unsupported`.

---

### Exit codes (git-remote-pear)

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General / unexpected error (logged to stderr) |
| 2 | User / ACL error (not a writer, rejected push) |
| 3 | Network error (no peers found within timeout) |

---

## B. pear-git CLI

### `pear-git init`

Create a new Pear-backed repo in the current directory.

**Usage:** `pear-git init [--name <alias>]`

**What it does:**
1. Generates or loads the user's identity keypair (`~/.pear-git/identity`).
2. Creates a new Autobase with this peer as the sole indexer.
3. Creates a bare Corestore at `~/.pear-git/stores/<repo-key>/`.
4. Initialises a working git clone at `./`.
5. Sets `origin` remote to `pear://<repo-key>`.
6. Writes a default `.gitignore` including `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/`.

**Stdout:**
```
pear://gK3p...QzM2
```
(Just the URL — machine-parseable.)

**Stderr:** Human-readable progress.

**Exit codes:** 0 success, 1 error (e.g. already a git repo).

---

### `pear-git invite <pubkey>`

Grant write access to another peer.

**Usage:** `pear-git invite <64-char-hex-pubkey> [--indexer]`

**What it does:**
1. Appends an `add-writer` op to the local input core. Must be run by an existing indexer.
2. If the repo already has a secrets key (`keyVersion > 0`): also appends a `secrets-key-envelope` op for the new writer, encrypted to their X25519 public key (derived from their ed25519 pubkey).
3. If the inviting peer doesn't have the secrets key themselves: prints a warning and proceeds with `add-writer` only.

**Stdout:**
```
Invited <pubkey-short> (indexer: yes|no)
```

**Stderr warning** (when secrets key cannot be distributed):
```
warning: could not distribute secrets key to new writer — an indexer with
secrets access must run 'pear-git secrets rotate' to grant them access.
```

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected error |
| 2 | Current user is not an indexer |
| 2 | Peer is already a writer |

---

### `pear-git revoke <pubkey>`

Remove write access from a peer.

**Usage:** `pear-git revoke <64-char-hex-pubkey>`

**What it does:** Appends a `remove-writer` op. Must be run by an existing indexer. Cannot remove the last indexer.

**Stdout:**
```
Revoked <pubkey-short>
```

**Stderr warning** (always printed when a secrets store exists):
```
warning: revoked writer retains read access to secrets encrypted before key rotation.
Run 'pear-git secrets rotate' to revoke their access.
```

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected error |
| 2 | Current user is not an indexer |
| 2 | Target is the last indexer (refused) |
| 2 | Target is not a writer |

---

### `pear-git seed [<key>...]`

Run as a long-lived seeder / always-on replica for one or more repos.

**Usage:** `pear-git seed [<pear-url-or-key>...]`

If no keys given, seeds all repos the peer has previously joined (from Corestore).

**What it does:** Joins the Hyperswarm topic for each repo key and keeps the process alive, replicating to any peer that connects.

**Stdout:** JSON-lines event stream (one object per line):
```json
{ "event": "peer-joined", "repoKey": "gK3p...", "peerId": "ab12...", "time": 1714000000000 }
{ "event": "peer-left",   "repoKey": "gK3p...", "peerId": "ab12...", "time": 1714000001000 }
{ "event": "blocks-synced", "repoKey": "gK3p...", "count": 42, "time": 1714000002000 }
```

If `--human` flag: formatted human-readable lines to stdout instead.

**Exit codes:** 0 on clean SIGINT/SIGTERM, 1 on error.

---

### `pear-git status`

Show current repo state.

**Usage:** `pear-git status [--json]`

**Human output (stdout):**
```
Repo:            pear://gK3p...QzM2
Peers:           3 connected
Signed length:   42 (stable)
Pending ops:     1 (not yet quorum-signed)
Rejected pushes: 0
Writers:         2 (1 indexer)
Secrets:         key v2, 3 files
```

**JSON output (`--json`):**
```json
{
  "repoKey": "gK3p...QzM2",
  "peers": 3,
  "signedLength": 42,
  "pendingOps": 1,
  "rejectedPushes": 0,
  "writers": 2,
  "indexers": 1,
  "secrets": { "keyVersion": 2, "fileCount": 3, "hasKey": true }
}
```

**Exit codes:** 0 success, 1 not inside a pear-git repo, 3 no peers (still shows local state).

---

### `pear-git secrets`

Subcommand group for managing encrypted secret files. See `architecture/secrets.md` for full design.

#### `pear-git secrets add <file>`

Encrypt a local file and push it to the secrets store.

**Usage:** `pear-git secrets add <local-file-path> [--name <store-path>]`

- `--name` overrides the path used as the key in the secrets store. Default: basename of the file (e.g. `pear-git secrets add .env` stores as `.env`).
- If this is the first secret and no secrets key exists yet: generates a random key, appends a `secrets-key-envelope` op for self (and any existing writers).

**Stdout:** `Added <store-path> (key version: <n>)`

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected error |
| 2 | Not a writer |
| 2 | No secrets key available (not yet distributed to this peer — ask an indexer to run `secrets rotate`) |

---

#### `pear-git secrets get <path>`

Fetch and decrypt a secret file.

**Usage:** `pear-git secrets get <store-path> [--output <local-file>]`

- Without `--output`: prints decrypted content to stdout.
- With `--output`: writes to the specified file path (creates or overwrites).

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected error |
| 2 | No secrets key (not a writer or envelope not yet received) |
| 2 | Path not found in secrets store |
| 2 | Key version mismatch — rotation in progress, retry shortly |

---

#### `pear-git secrets list`

List all secret file paths in the store.

**Usage:** `pear-git secrets list [--json]`

**Human output (stdout):** One path per line.
```
.env
config/api.json
```

**JSON output:** `["env", "config/api.json"]`

**Exit codes:** 0 success, 1 error, 2 no secrets key.

---

#### `pear-git secrets rm <path>`

Remove a secret file from the store.

**Usage:** `pear-git secrets rm <store-path>`

Deletes the entry from the `secrets/` Hyperbee. Does not rotate the key; removed file is unrecoverable for all peers once replicated.

**Stdout:** `Removed <path>`

**Exit codes:** 0 success, 1 error, 2 not a writer, 2 path not found.

---

#### `pear-git secrets rotate`

Rotate the secrets key. Indexers only.

**Usage:** `pear-git secrets rotate`

**What it does:**
1. Generates a new random 32-byte secrets key.
2. Re-encrypts all files in the `secrets/` Hyperbee with the new key.
3. Appends a `secrets-key-rotate` Autobase op (increments `keyVersion`).
4. Appends a `secrets-key-envelope` op for every current writer.

Must be run after revoking a writer to remove their read access to future secrets.

**Stdout:** `Rotated to key version <n>. Re-encrypted <m> files.`

**Exit codes:** 0 success, 1 error, 2 not an indexer.
