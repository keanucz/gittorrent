import assert from 'node:assert/strict'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 32: repository list and read-only status dashboard', () => {
  test('AC1: repositories route uses backend data source', async () => {
    const requiredFiles = [
      'src/ui/routes/Repositories.tsx',
      'src/ui/routes/RepositoryDetail.tsx',
      'src/ui/components/StatusCards.tsx',
      'src/ui/state/repo-queries.ts'
    ]

    for (const file of requiredFiles) {
      await fileExists(join(desktopRoot, file))
    }

    const repositories = await readFile(join(desktopRoot, 'src/ui/routes/Repositories.tsx'), 'utf-8')
    assert.match(repositories, /useRepoList|repoList/i, 'repositories route should render backend repo list data')
  })

  test('AC2: selecting a repo loads repo status metrics', async () => {
    const detail = await readFile(join(desktopRoot, 'src/ui/routes/RepositoryDetail.tsx'), 'utf-8')
    assert.match(detail, /selectedRepo|selectedPath|repoPath/, 'detail route should depend on selected repo')
    assert.match(detail, /useRepoStatus|repoStatus/i, 'detail route should load status for selected repo')

    const statusCards = await readFile(join(desktopRoot, 'src/ui/components/StatusCards.tsx'), 'utf-8')
    assert.match(statusCards, /peers|signed_length|pending_ops|last_error/i, 'status cards should show required status metrics')
  })

  test('AC3 and AC4: loading/empty/error states and refresh controls are implemented', async () => {
    const queries = await readFile(join(desktopRoot, 'src/ui/state/repo-queries.ts'), 'utf-8')
    assert.match(queries, /loading/i, 'repo query layer should track loading state')
    assert.match(queries, /error/i, 'repo query layer should track error state')
    assert.match(queries, /setInterval|refreshIntervalMs/i, 'repo status should support auto refresh interval')
    assert.match(queries, /refresh|reload/i, 'repo status should support manual refresh')

    const repositories = await readFile(join(desktopRoot, 'src/ui/routes/Repositories.tsx'), 'utf-8')
    assert.match(repositories, /No repositories|empty/i, 'repositories route should include empty state messaging')

    const detail = await readFile(join(desktopRoot, 'src/ui/routes/RepositoryDetail.tsx'), 'utf-8')
    assert.match(detail, /Retry|Refresh|error/i, 'detail route should handle failure and refresh states')
  })

  test('AC5: no write actions are exposed in task 32 routes', async () => {
    const repositories = await readFile(join(desktopRoot, 'src/ui/routes/Repositories.tsx'), 'utf-8')
    const detail = await readFile(join(desktopRoot, 'src/ui/routes/RepositoryDetail.tsx'), 'utf-8')

    assert.doesNotMatch(repositories, /repoPull|repoPush|writerInvite|writerRevoke|secrets_add|seed_start/, 'repositories route should stay read-only')
    assert.doesNotMatch(detail, /repoPull|repoPush|writerInvite|writerRevoke|secrets_add|seed_start/, 'detail route should stay read-only')
  })
})
