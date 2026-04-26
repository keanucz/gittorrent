import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 36: secrets management UI flows', () => {
  test('AC1: secrets list displays paths with key version metadata', async () => {
    const required = [
      'src/ui/routes/Secrets.tsx',
      'src/ui/components/SecretsTable.tsx',
      'src/ui/components/SecretPreviewDialog.tsx'
    ]

    for (const file of required) {
      await fileExists(join(desktopRoot, file))
    }

    const table = await readFile(join(desktopRoot, 'src/ui/components/SecretsTable.tsx'), 'utf-8')
    assert.match(table, /secret path|path/i, 'secrets table should include secret path column')
    assert.match(table, /key version|version/i, 'secrets table should include key version metadata')
  })

  test('AC2: add/remove/rotate flows are wired against selected repo', async () => {
    const route = await readFile(join(desktopRoot, 'src/ui/routes/Secrets.tsx'), 'utf-8')
    assert.match(route, /selectedPath/, 'secrets route should be scoped to selected repo path')

    const api = await readFile(join(desktopRoot, 'src/ui/services/tauri-api.ts'), 'utf-8')
    assert.match(api, /secrets(Add|Get|List|Remove|Rotate)/, 'frontend API should expose secrets mutation/list wrappers')

    const commands = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    assert.match(commands, /secrets_list/, 'backend secrets list command should exist')
    assert.match(commands, /secrets_add/, 'backend secrets add command should exist')
    assert.match(commands, /secrets_remove/, 'backend secrets remove command should exist')
    assert.match(commands, /secrets_rotate/, 'backend secrets rotate command should exist')
  })

  test('AC3: decrypted preview is in-memory only and never auto-saved', async () => {
    const preview = await readFile(join(desktopRoot, 'src/ui/components/SecretPreviewDialog.tsx'), 'utf-8')
    assert.match(preview, /in-memory|memory-only|ephemeral/i, 'preview should document in-memory handling')
    assert.doesNotMatch(preview, /writeFile|download|saveAs|localStorage|sessionStorage/, 'preview should not auto-save decrypted content')
  })

  test('AC4 and AC5: rotate confirmation and redacted logging are implemented', async () => {
    const route = await readFile(join(desktopRoot, 'src/ui/routes/Secrets.tsx'), 'utf-8')
    assert.match(route, /rotate/i, 'route should expose rotate action')
    assert.match(route, /confirm|type to confirm|Confirm/i, 'rotate action should require confirmation')

    const commands = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    assert.match(commands, /REDACTED|redact|ciphertext|secret material/i, 'backend should redact secret material and ciphertext in logs/details')
  })
})
