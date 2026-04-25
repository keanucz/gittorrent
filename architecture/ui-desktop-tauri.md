# Desktop UI Architecture (Tauri)

## Scope

Add a desktop application for gittorrent that provides a visual interface for repository discovery, clone/init workflows, peer visibility, writer management, and secret file operations.

The desktop app is an additional client, not a replacement for the existing CLI. It uses the same repository data and protocol semantics already defined in architecture documents.

## Goals

- Provide a local-first desktop UX for common flows: init, clone, pull, push, invite, revoke, seed, status, and secrets.
- Keep a strict boundary between UI and core git/P2P logic to avoid protocol regressions.
- Preserve deterministic backend behavior by delegating mutations to existing CLI and library modules.
- Enforce secure desktop defaults for a decentralized system: minimal command surface, no secret leakage, explicit trust indicators.

## Non-goals (v1)

- Cloud account sync, hosted identity, or centralized auth.
- Web deployment.
- Full GitHub parity (issues, pull requests, actions, org admin).
- Background daemon beyond explicit user opt-in seeding.

## Runtime Model

- Shell: Tauri 2.x desktop app.
- Frontend: Vite + TypeScript + React (or existing team preference equivalent).
- Backend bridge: Rust Tauri commands that invoke vetted Node-side operations.
- Data source:
  - Existing `lib/*` modules and `bin/pear-git` for all domain operations.
  - Read-only status snapshots through explicit IPC command handlers.

## Layered Architecture

### 1) Presentation layer (frontend)

Responsibilities:
- Render pages and panels (Repos, Activity, Peers, Writers, Secrets, Settings).
- Manage local UI state and optimistic transitions.
- Never directly access disk, keys, or shell commands.

Key modules:
- `src/ui/routes/*` route-level screens.
- `src/ui/components/*` reusable widgets.
- `src/ui/state/*` store and query hooks.
- `src/ui/theme/*` design tokens and style system.

### 2) Application layer (frontend service)

Responsibilities:
- Convert user intents to typed IPC calls.
- Normalize backend responses and errors.
- Handle retries, cancellation, and progress updates.

Key module:
- `src/ui/services/tauri-api.ts` typed wrappers over Tauri `invoke`.

### 3) Desktop bridge (Tauri commands in Rust)

Responsibilities:
- Expose a strict allowlist of commands.
- Validate inputs and enforce path/url safety.
- Spawn child processes only for approved binaries (`pear-git`, `git`).
- Stream progress events to frontend via Tauri events.

Key module:
- `src-tauri/src/commands.rs`.

### 4) Domain/Protocol layer (existing JS code)

Responsibilities:
- Repo initialization, swarm join/leave, ACL ops, object/ref sync, secret encryption handling.
- No UI assumptions.

Key integration points:
- `bin/pear-git` subcommands for user-facing operations.
- `lib/autobase-repo.js`, `lib/swarm.js`, `lib/secrets.js`, `lib/remote-helper.js`.

## IPC Contract (v1)

All commands are explicit and typed. No generic shell passthrough.

- `repo_list()` -> list known local repos.
- `repo_init(path)` -> create/init repo and return `pear://` URL.
- `repo_clone(url, path)` -> clone from `pear://`.
- `repo_status(path)` -> peers, writers, signed length, pending ops.
- `repo_pull(path)` -> pull and return summary.
- `repo_push(path, branch)` -> push and return summary/rejection reason.
- `writer_invite(path, pubkey, indexer)` -> invite writer.
- `writer_revoke(path, pubkey)` -> revoke writer.
- `secrets_add(path, filePath)` -> encrypt and add secret file.
- `secrets_get(path, secretPath)` -> decrypt and return plaintext (in memory only).
- `secrets_list(path)` -> list secret paths + key version metadata.
- `seed_start(path)` and `seed_stop(path)` -> explicit seeding control.

## Security Constraints

- UI never receives private key material from `identity.js`.
- Secrets plaintext is never persisted by the UI unless user chooses export.
- IPC rejects relative traversal and non-workspace absolute paths unless explicitly allowed by file picker flow.
- No arbitrary process execution from frontend; only allowlisted command handlers.
- Log redaction:
  - redact repo secrets and ciphertext blobs
  - truncate peer identifiers in default log output
- Tauri capability model:
  - minimal filesystem scopes
  - explicit command permission list
  - disable unused plugins/features

## Data and State Flow

1. User action in UI triggers a typed service call.
2. Service invokes Tauri command.
3. Tauri command validates input and executes a domain operation.
4. Progress events are emitted (`sync:progress`, `seed:status`, `repo:changed`).
5. UI query cache/store is invalidated and refreshed from `repo_status`.

## UI Information Architecture (v1)

- Repositories:
  - list local repos, quick status badges, open-in-folder action.
- Repository detail:
  - Overview: URL, branch, latest commit, push/pull actions.
  - Sync: peers, signed length, pending ops, last errors.
  - Writers: list/add/revoke with indexer badge.
  - Secrets: add/get/list/rm and key rotation status.
  - Seed: current state, start/stop, session duration.
- Settings:
  - env var-backed configuration (`PEAR_GIT_*`), logging level, bootstrap nodes.

## Performance and Reliability

- All long-running operations are async with cancel support.
- Per-action timeout defaults:
  - status: 5s
  - pull/push: 20s
  - clone/init: 60s
- Idempotent UI retries for status and list operations.
- Crash recovery:
  - preserve recent repo list and pending UI jobs in local app state.

## Suggested Project Structure (UI track)

```
interface/desktop/
  package.json
  src/
    ui/
      routes/
      components/
      services/
      state/
      theme/
    main.tsx
  src-tauri/
    src/
      main.rs
      commands.rs
      process.rs
      validation.rs
    tauri.conf.json
```

## Testing Strategy

- Unit tests (frontend): component rendering, state transitions, API adapter behavior.
- Contract tests (desktop bridge): command validation and output mapping.
- Integration tests: run selected repo workflows against local test fixtures.
- E2E smoke: app launches, init/clone/status flows, writer invite flow.

## Rollout Plan

- Phase 1: App scaffold + read-only status dashboard.
- Phase 2: Clone/init + pull/push actions.
- Phase 3: Writers and secrets management.
- Phase 4: Seed controls, logs, hardening, packaging.

## Open Decisions

- Final frontend framework choice if not React.
- Whether to call `bin/pear-git` subprocesses directly or expose a thin JS command server embedded in Tauri.
- Packaging targets for first release (Windows only vs Windows/macOS/Linux).
