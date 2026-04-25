# Task 35: Implement writers management (invite and revoke)

- **Agent:** `fullstack-dev`
- **Depends on:** Task 31, Task 34, Task 20
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/auth.md`, `architecture/security.md`

## Description

Implement Writers panel UI and backend commands for invite/revoke operations. Include indexer badge handling and permission-aware messaging.

## Files to create/modify

- `interface/desktop/src/ui/routes/Writers.tsx`
- `interface/desktop/src/ui/components/WriterTable.tsx`
- `interface/desktop/src/ui/components/InviteWriterDialog.tsx`
- `interface/desktop/src-tauri/src/commands.rs`

## Acceptance Criteria

- [ ] Writers list displays key, role, and indexer status.
- [ ] Invite validates pubkey format and indexer option.
- [ ] Revoke action requires explicit confirmation.
- [ ] Permission failures map to user-level error messages.
