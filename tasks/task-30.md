# Task 30: Define UI design system and navigation shell

- **Agent:** `frontend-dev`
- **Depends on:** Task 29
- **Architecture files:** `architecture/ui-desktop-tauri.md`

## Description

Implement the desktop navigation shell and foundational design system for the app: typography tokens, spacing scale, color tokens, and reusable layout primitives. Add route placeholders for the v1 information architecture.

## Files to create/modify

- `interface/desktop/src/ui/theme/tokens.css`
- `interface/desktop/src/ui/components/AppShell.tsx`
- `interface/desktop/src/ui/components/Sidebar.tsx`
- `interface/desktop/src/ui/routes/*.tsx`

## Acceptance Criteria

- [ ] Navigation includes Repositories, Repo Detail, Writers, Secrets, Seed, and Settings routes.
- [ ] Theme tokens are centralized and consumed by core components.
- [ ] Layout is responsive for standard desktop sizes and narrow windows.
- [ ] Accessibility basics are present: keyboard focus visibility, semantic landmarks, color contrast.
