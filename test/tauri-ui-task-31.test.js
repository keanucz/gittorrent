import assert from 'node:assert/strict'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 31: tauri command bridge and typed IPC', () => {
  test('AC1: allowlisted command bridge files exist with no generic exec endpoint', async () => {
    const files = [
      'src-tauri/src/commands.rs',
      'src-tauri/src/validation.rs',
      'src-tauri/src/process.rs',
      'src/ui/services/tauri-api.ts',
      'src/ui/types/ipc.ts'
    ]

    for (const file of files) {
      await fileExists(join(desktopRoot, file))
    }

    const commandsRs = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    assert.match(commandsRs, /repo_list/, 'allowlist should include repo_list command')
    assert.match(commandsRs, /repo_status/, 'allowlist should include repo_status command')
    assert.match(commandsRs, /repo_pull/, 'allowlist should include repo_pull command')
    assert.match(commandsRs, /repo_push/, 'allowlist should include repo_push command')
    assert.doesNotMatch(commandsRs, /exec_command|run_command|shell_exec|command_passthrough/, 'generic command endpoints must not exist')
  })

  test('AC2: validation covers path traversal, pear URL, and pubkey checks', async () => {
    const validationRs = await readFile(join(desktopRoot, 'src-tauri/src/validation.rs'), 'utf-8')

    assert.match(validationRs, /ParentDir|\.\./, 'validation should reject path traversal')
    assert.match(validationRs, /pear:\/\//, 'validation should verify pear:// URL format')
    assert.match(validationRs, /64/, 'validation should enforce 64-char pubkey length')
    assert.match(validationRs, /is_ascii_hexdigit|hex/, 'validation should enforce hex pubkey characters')
  })

  test('AC3: frontend API is typed and wraps command calls', async () => {
    const ipcTypes = await readFile(join(desktopRoot, 'src/ui/types/ipc.ts'), 'utf-8')
    assert.match(ipcTypes, /export interface RepoStatusResponse/, 'typed response interfaces should exist')
    assert.match(ipcTypes, /export type UiErrorCode/, 'stable UI error code type should exist')

    const tauriApi = await readFile(join(desktopRoot, 'src/ui/services/tauri-api.ts'), 'utf-8')
    assert.match(tauriApi, /invoke(<[^>]+>)?\(/, 'frontend API should call tauri invoke')
    assert.match(tauriApi, /repoList|repoStatus|repoPull|repoPush/, 'frontend API should expose typed wrappers')
  })

  test('AC4 and AC5: stable error normalization and unit tests exist', async () => {
    const processRs = await readFile(join(desktopRoot, 'src-tauri/src/process.rs'), 'utf-8')
    assert.match(processRs, /UiErrorCode/, 'error normalization code enum should exist')
    assert.match(processRs, /map_exit_code/, 'process errors should map CLI exit codes')

    const tauriApi = await readFile(join(desktopRoot, 'src/ui/services/tauri-api.ts'), 'utf-8')
    assert.match(tauriApi, /mapTauriError/, 'frontend should normalize backend errors')

    const validationRs = await readFile(join(desktopRoot, 'src-tauri/src/validation.rs'), 'utf-8')
    assert.match(validationRs, /#\[cfg\(test\)\]/, 'validation module should include unit tests')
    assert.match(processRs, /#\[cfg\(test\)\]/, 'process module should include unit tests')
  })
})
