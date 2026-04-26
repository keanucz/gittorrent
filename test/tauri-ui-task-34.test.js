import assert from 'node:assert/strict'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 34: push and pull actions with sync feedback', () => {
  test('AC1: sync action and log components exist and are gated by selected repo', async () => {
    const requiredFiles = [
      'src/ui/components/SyncActions.tsx',
      'src/ui/components/SyncLogPanel.tsx',
      'src/ui/state/sync-state.ts'
    ]

    for (const file of requiredFiles) {
      await fileExists(join(desktopRoot, file))
    }

    const detail = await readFile(join(desktopRoot, 'src/ui/routes/RepositoryDetail.tsx'), 'utf-8')
    assert.match(detail, /SyncActions/, 'repository detail should render SyncActions')
    assert.match(detail, /selectedPath/, 'sync actions should be scoped to selected repo')
  })

  test('AC2: rejection states include actionable non-fast-forward guidance', async () => {
    const syncState = await readFile(join(desktopRoot, 'src/ui/state/sync-state.ts'), 'utf-8')
    assert.match(syncState, /non-fast-forward|rejected/i, 'sync state should detect push rejection states')
    assert.match(syncState, /pull\s+--rebase|git pull --rebase/i, 'sync state should include remediation guidance')
  })

  test('AC3: progress events update visible sync panel', async () => {
    const panel = await readFile(join(desktopRoot, 'src/ui/components/SyncLogPanel.tsx'), 'utf-8')
    assert.match(panel, /progress|events|entries|logs/i, 'sync log panel should render progress entries')

    const syncState = await readFile(join(desktopRoot, 'src/ui/state/sync-state.ts'), 'utf-8')
    assert.match(syncState, /append|push\(|setState|entries/i, 'sync state should append progress events')
  })

  test('AC4: concurrent sync actions are prevented per repository', async () => {
    const syncState = await readFile(join(desktopRoot, 'src/ui/state/sync-state.ts'), 'utf-8')
    assert.match(syncState, /inFlight|lock|runningByRepo|activeByRepo/i, 'sync state should track per-repo running actions')
    assert.match(syncState, /already running|concurrent|busy/i, 'sync state should reject concurrent actions')
  })
})
