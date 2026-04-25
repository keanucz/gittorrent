# Task 29: Scaffold Tauri desktop app workspace

- **Agent:** `frontend-dev`
- **Depends on:** Task 28
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/project-structure.md`, `architecture/tech-stack.md`

## Description

Create the initial desktop UI workspace under `interface/desktop/` using Tauri 2.x with a TypeScript frontend. This task establishes project structure, scripts, and baseline app startup without business features.

## Files to create/modify

- `interface/desktop/package.json`
- `interface/desktop/src/main.tsx`
- `interface/desktop/src/ui/routes/Home.tsx`
- `interface/desktop/src-tauri/Cargo.toml`
- `interface/desktop/src-tauri/src/main.rs`
- `interface/desktop/src-tauri/tauri.conf.json`

## Acceptance Criteria

- [ ] `pnpm` or `npm` install succeeds in `interface/desktop/`.
- [ ] `tauri dev` launches the app shell with a visible home screen.
- [ ] Build scripts exist for `dev`, `build`, and `lint`.
- [ ] Frontend TypeScript checks pass.
- [ ] Rust side compiles with no warnings elevated to errors.
- [ ] No domain commands are exposed yet beyond a health check command.
