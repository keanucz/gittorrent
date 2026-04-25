# Task 33: Implement clone and init repository flows

- **Agent:** `fullstack-dev`
- **Depends on:** Task 31, Task 32, Task 18
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/cli-interface.md`

## Description

Add desktop actions for `repo_init` and `repo_clone`. Users can select a target folder, run the operation, and receive resulting repo metadata including `pear://` URL.

## Files to create/modify

- `interface/desktop/src/ui/components/CloneDialog.tsx`
- `interface/desktop/src/ui/components/InitDialog.tsx`
- `interface/desktop/src/ui/state/repo-mutations.ts`
- `interface/desktop/src-tauri/src/commands.rs`

## Acceptance Criteria

- [ ] Clone flow validates `pear://` URL before submission.
- [ ] Init flow returns and displays created repo URL.
- [ ] Operation progress and failures are shown in UI.
- [ ] Successful operations invalidate and refresh repository list.
