import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 35: writers management (invite and revoke)', () => {
  test('AC1: writers list UI shows key, role, and indexer status', async () => {
    const requiredFiles = [
      'src/ui/routes/Writers.tsx',
      'src/ui/components/WriterTable.tsx',
      'src/ui/components/InviteWriterDialog.tsx'
    ]

    for (const file of requiredFiles) {
      await fileExists(join(desktopRoot, file))
    }

    const table = await readFile(join(desktopRoot, 'src/ui/components/WriterTable.tsx'), 'utf-8')
    assert.match(table, /Key/i, 'writer table should include key column')
    assert.match(table, /Role/i, 'writer table should include role column')
    assert.match(table, /Indexer/i, 'writer table should include indexer status column')
  })

  test('AC2: invite flow validates pubkey and supports indexer option', async () => {
    const invite = await readFile(join(desktopRoot, 'src/ui/components/InviteWriterDialog.tsx'), 'utf-8')
    assert.match(invite, /64|hex|pubkey/i, 'invite dialog should validate pubkey format')
    assert.match(invite, /indexer/i, 'invite dialog should include indexer option')

    const commands = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    assert.match(commands, /validate_pubkey/, 'backend invite command should validate pubkey')
    assert.match(commands, /writer_invite/, 'backend invite command should exist')
  })

  test('AC3: revoke flow requires explicit confirmation', async () => {
    const table = await readFile(join(desktopRoot, 'src/ui/components/WriterTable.tsx'), 'utf-8')
    assert.match(table, /confirm|type to confirm|Confirm/i, 'revoke flow should require explicit confirmation')

    const commands = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    assert.match(commands, /writer_revoke/, 'backend revoke command should exist')
  })

  test('AC4: permission failures are mapped to user-level errors', async () => {
    const commands = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    assert.match(commands, /PermissionDenied|not an indexer|permission/i, 'backend should map permission failures')

    const tauriApi = await readFile(join(desktopRoot, 'src/ui/services/tauri-api.ts'), 'utf-8')
    assert.match(tauriApi, /PERMISSION_DENIED|mapTauriError/, 'frontend should map permission errors to user-level messages')

    const writersRoute = await readFile(join(desktopRoot, 'src/ui/routes/Writers.tsx'), 'utf-8')
    assert.match(writersRoute, /permission|not an indexer|allowed/i, 'writers route should display permission-aware message')
  })
})
