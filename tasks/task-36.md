# Task 36: Implement secrets management UI flows

- **Agent:** `fullstack-dev`
- **Depends on:** Task 31, Task 34, Task 26
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/secrets.md`, `architecture/security.md`

## Description

Implement Secrets panel with add/get/list/rm/rotate flows, using secure handling for decrypted content and redacted logs.

## Files to create/modify

- `interface/desktop/src/ui/routes/Secrets.tsx`
- `interface/desktop/src/ui/components/SecretsTable.tsx`
- `interface/desktop/src/ui/components/SecretPreviewDialog.tsx`
- `interface/desktop/src-tauri/src/commands.rs`

## Acceptance Criteria

- [ ] Secret paths list with key version metadata.
- [ ] Add and remove flows work against selected repository.
- [ ] Decrypted secret preview is in-memory only and never auto-saved.
- [ ] Rotate action exposes confirmation and completion status.
- [ ] Logs redact secret material and ciphertext payloads.
