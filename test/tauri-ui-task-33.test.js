import assert from 'node:assert/strict'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 33: clone and init repository flows', () => {
  test('AC1 and AC2: clone/init dialog files exist and validate/display URL data', async () => {
    const requiredFiles = [
      'src/ui/components/CloneDialog.tsx',
      'src/ui/components/InitDialog.tsx',
      'src/ui/state/repo-mutations.ts'
    ]

    for (const file of requiredFiles) {
      await fileExists(join(desktopRoot, file))
    }

    const cloneDialog = await readFile(join(desktopRoot, 'src/ui/components/CloneDialog.tsx'), 'utf-8')
    assert.match(cloneDialog, /gittorrent:\/\//, 'clone dialog should validate pear:// URL')
    assert.match(cloneDialog, /onSubmit|cloneRepo/i, 'clone dialog should submit clone operation')

    const initDialog = await readFile(join(desktopRoot, 'src/ui/components/InitDialog.tsx'), 'utf-8')
    assert.match(initDialog, /gittorrent:\/\//, 'init dialog should display returned pear:// URL')
    assert.match(initDialog, /initRepo|onSubmit/i, 'init dialog should submit init operation')
  })

  test('AC3 and AC4: mutation layer exposes progress/errors and refresh invalidation hook', async () => {
    const mutations = await readFile(join(desktopRoot, 'src/ui/state/repo-mutations.ts'), 'utf-8')
    assert.match(mutations, /loading|inProgress|progress/i, 'mutation layer should expose operation progress state')
    assert.match(mutations, /error/i, 'mutation layer should expose failures')
    assert.match(mutations, /onSuccess|refreshRepoList|invalidate/i, 'successful mutations should refresh repository list')
  })

  test('commands include repo_init and repo_clone allowlisted handlers', async () => {
    const commands = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    const mainRs = await readFile(join(desktopRoot, 'src-tauri/src/main.rs'), 'utf-8')

    assert.match(commands, /fn\s+repo_init\s*\(/, 'Rust command repo_init should exist')
    assert.match(commands, /fn\s+repo_clone\s*\(/, 'Rust command repo_clone should exist')
    assert.match(mainRs, /repo_init/, 'repo_init should be allowlisted')
    assert.match(mainRs, /repo_clone/, 'repo_clone should be allowlisted')
  })

  test('repositories route wires dialogs and mutation actions', async () => {
    const repositories = await readFile(join(desktopRoot, 'src/ui/routes/Repositories.tsx'), 'utf-8')
    assert.match(repositories, /CloneDialog|InitDialog/, 'repositories view should expose clone/init dialogs')
    assert.match(repositories, /useRepoMutations/, 'repositories view should use repo mutation hook')
  })
})
