# Task 31: Implement Tauri command bridge and IPC typing

- **Agent:** `fullstack-dev`
- **Depends on:** Task 29
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/security.md`, `architecture/cli-interface.md`

## Description

Create the Rust command layer and frontend API wrapper that expose a strict allowlist of typed IPC commands for repo and sync operations. Include input validation and consistent error mapping.

## Files to create/modify

- `interface/desktop/src-tauri/src/commands.rs`
- `interface/desktop/src-tauri/src/validation.rs`
- `interface/desktop/src-tauri/src/process.rs`
- `interface/desktop/src/ui/services/tauri-api.ts`
- `interface/desktop/src/ui/types/ipc.ts`

## Acceptance Criteria

- [ ] Commands are allowlisted and no generic command execution endpoint exists.
- [ ] Inputs are validated for path traversal, invalid URLs, and malformed pubkeys.
- [ ] Frontend service wraps all command calls with typed request/response interfaces.
- [ ] Errors are normalized into stable UI error codes/messages.
- [ ] Unit tests cover validation and error mapping branches.
