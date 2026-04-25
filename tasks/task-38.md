# Task 38: UI test suite, packaging, and release readiness

- **Agent:** `qa-release-dev`
- **Depends on:** Task 35, Task 36, Task 37
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/build.md`

## Description

Finalize the desktop UI track with automated tests, smoke E2E coverage, and packaged release artifacts for the initial target platform.

## Files to create/modify

- `interface/desktop/src/ui/**/*.test.tsx`
- `interface/desktop/src-tauri/src/**/*.rs` (test modules)
- `interface/desktop/e2e/*.spec.ts`
- `interface/desktop/README.md`

## Acceptance Criteria

- [ ] Frontend unit tests cover critical UI states and mutation flows.
- [ ] Rust command tests cover validation and process execution paths.
- [ ] E2E smoke covers app launch, clone/init, status refresh, and push/pull actions.
- [ ] Packaged desktop artifact builds successfully.
- [ ] Release notes include known limitations and security caveats.
