# CLI Interface

*(Replaces `frontend-components.md` — this project has no web frontend.)*

Documents the UX conventions, output formats, and behavioural contracts for the two binaries: `pear-git` and `git-remote-pear`.

---

## Output stream rules

| Binary | stdout | stderr |
|---|---|---|
| `git-remote-pear` | Protocol bytes only. Any non-protocol output here breaks git silently. | All human messages, progress, and log output. |
| `pear-git` | Primary output (URLs, status, JSON). | Progress, warnings, log output. |

These rules are **hard constraints**, not preferences. See `architecture/logging.md` for the logging implementation that enforces them.

---

## Exit code conventions

All binaries use this code table consistently:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General / unexpected error |
| 2 | User / permission error (bad args, not a writer, refused by ACL) |
| 3 | Network error (no peers found within timeout) |

---

## Error message format

All error messages to stderr follow this form:
```
pear-git: error: <message>
```

Examples:
```
pear-git: error: not an indexer — cannot invite writers
pear-git: error: no peers found for repo gK3p...QzM2 after 10s
pear-git: error: identity file not found at /home/user/.pear-git/identity
```

For `git-remote-pear`, errors visible to the git user appear via the protocol's `error` lines (see `architecture/protocols.md`). Internal errors go to stderr with the same format:
```
git-remote-pear: error: <message>
```

---

## Progress output format

Progress lines go to **stderr** in both binaries. Format:
```
<verb> <noun>: <count>/<total>
```

Examples:
```
Fetching objects: 42/100
Pushing objects: 7/7
Replicating blocks: 1024/4096
```

When total is unknown:
```
Fetching objects: 42
```

Progress lines are suppressed when `option progress false` is sent by git, or when `PEAR_GIT_LOG_LEVEL=error`.

---

## Key UX flows

### 1. New repo

```bash
mkdir my-project && cd my-project
git init
git add . && git commit -m "Initial commit"
pear-git init
# stdout: pear://gK3p...QzM2
# stderr: Repo created. Share this URL with collaborators.
git push origin main
```

### 2. Clone

```bash
git clone pear://gK3p...QzM2
# Standard git output — git-remote-pear handles the P2P side transparently
cd gK3p...QzM2
git log
```

### 3. Add a collaborator

```bash
# Collaborator runs this on their machine:
pear-git status
# stdout: (no repo yet — prints their public key if called outside a repo)

# Actually: they share their public key out-of-band (e.g. paste it in chat).
# Indexer runs on their machine:
pear-git invite 4a2f...8bc0 --indexer
# stdout: Invited 4a2f...8bc0 (indexer: yes)
```

### 4. Push conflict

A concurrent push from two writers results in one being rejected. The rejected writer sees standard git output:
```
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'pear://gK3p...QzM2'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart.
```

Resolution: `git pull --rebase origin main` then push again. Same UX as GitHub.

### 5. Offline push

```bash
# Disconnect from network
git commit -m "Offline work"
git push origin main
# stderr: Push queued locally — no peers reachable. Will sync on reconnect.
# stdout: ok refs/heads/main   (local apply succeeded)

# Reconnect — Autobase propagates the op automatically when peers are found.
```

---

## pear-git status output fields

| Field | Meaning |
|---|---|
| `Repo` | The `pear://` URL for this repo |
| `Peers` | Number of currently connected Hyperswarm peers |
| `Signed length` | Autobase `signedLength` — ops before this are immutably stable |
| `Pending ops` | Ops in the causal tail not yet quorum-signed |
| `Rejected pushes` | Count of entries in the rejection log (use `pear-git log --rejected` to see detail — stretch goal) |
| `Writers` | Total writer count, with indexer count in parentheses |

The `Signed length` field is the key trust indicator. History before this point cannot be reordered. Pending ops may still be reordered by Autobase as new causal info arrives.

---

## Machine-readable flag convention

Any `pear-git` subcommand that produces structured output supports `--json`, which switches stdout to newline-delimited JSON. This enables scripting and tooling without screen-scraping.

Streaming commands (like `pear-git seed`) always emit JSON lines by default, with `--human` as the opt-in for human-readable output.
