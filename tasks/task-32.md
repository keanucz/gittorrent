# Task 32: Build repository list and read-only status dashboard

- **Agent:** `frontend-dev`
- **Depends on:** Task 30, Task 31, Task 24
- **Architecture files:** `architecture/ui-desktop-tauri.md`, `architecture/cli-interface.md`

## Description

Implement read-only repository visibility in the desktop app: known repos list, selected repo overview, and status metrics (peers, signed length, pending ops, last sync errors).

## Files to create/modify

- `interface/desktop/src/ui/routes/Repositories.tsx`
- `interface/desktop/src/ui/routes/RepositoryDetail.tsx`
- `interface/desktop/src/ui/components/StatusCards.tsx`
- `interface/desktop/src/ui/state/repo-queries.ts`

## Acceptance Criteria

- [ ] Repositories list renders from backend data source.
- [ ] Selecting a repo loads status metrics and latest summary data.
- [ ] Loading, empty, and failure states are handled.
- [ ] Status refresh can be manually triggered and auto-refreshed on interval.
- [ ] No write actions are available in this task.
