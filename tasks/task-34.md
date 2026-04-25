# Task 34: Implement push and pull actions with sync feedback

- **Agent:** `fullstack-dev`
- **Depends on:** Task 31, Task 33, Task 24
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/protocols.md`, `architecture/cli-interface.md`

## Description

Add write operations for `repo_pull` and `repo_push` in the repository detail view. Include progress, completion summary, and deterministic handling of non-fast-forward rejections.

## Files to create/modify

- `interface/desktop/src/ui/components/SyncActions.tsx`
- `interface/desktop/src/ui/components/SyncLogPanel.tsx`
- `interface/desktop/src/ui/state/sync-state.ts`
- `interface/desktop/src-tauri/src/commands.rs`

## Acceptance Criteria

- [ ] Pull and push actions are available only when a repo is selected.
- [ ] Rejection states are surfaced with actionable guidance.
- [ ] Progress events update a visible sync panel.
- [ ] Concurrent action execution is prevented per repository.
