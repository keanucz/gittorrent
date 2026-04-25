# Task 37: Implement seeding controls, settings, and hardening

- **Agent:** `fullstack-dev`
- **Depends on:** Task 31, Task 34, Task 36, Task 22
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/env-vars.md`, `architecture/logging.md`

## Description

Add seed start/stop controls, environment-backed settings, and desktop hardening defaults (minimal Tauri permissions, command allowlist verification, and log controls).

## Files to create/modify

- `interface/desktop/src/ui/routes/Seed.tsx`
- `interface/desktop/src/ui/routes/Settings.tsx`
- `interface/desktop/src-tauri/tauri.conf.json`
- `interface/desktop/src-tauri/src/commands.rs`

## Acceptance Criteria

- [ ] Seed controls show current state and session duration.
- [ ] Settings map to documented `PEAR_GIT_*` values.
- [ ] Tauri capabilities are minimal and explicit.
- [ ] Command allowlist is audited with no unused privileged commands.
- [ ] Log verbosity can be adjusted without restarting the app.
