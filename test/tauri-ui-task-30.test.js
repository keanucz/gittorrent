import assert from 'node:assert/strict'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 30: design system and navigation shell', () => {
  test('AC1: navigation routes and shell files exist', async () => {
    const requiredFiles = [
      'src/ui/theme/tokens.css',
      'src/ui/components/AppShell.tsx',
      'src/ui/components/Sidebar.tsx',
      'src/ui/routes/Repositories.tsx',
      'src/ui/routes/RepositoryDetail.tsx',
      'src/ui/routes/Writers.tsx',
      'src/ui/routes/Secrets.tsx',
      'src/ui/routes/Seed.tsx',
      'src/ui/routes/Settings.tsx'
    ]

    for (const relativePath of requiredFiles) {
      await fileExists(join(desktopRoot, relativePath))
    }

    const sidebarSource = await readFile(join(desktopRoot, 'src/ui/components/Sidebar.tsx'), 'utf-8')
    for (const label of ['Repositories', 'Repo Detail', 'Writers', 'Secrets', 'Seed', 'Settings']) {
      assert.match(sidebarSource, new RegExp(label), `sidebar should include ${label}`)
    }
  })

  test('AC2: tokens are centralized and consumed by core components', async () => {
    const tokens = await readFile(join(desktopRoot, 'src/ui/theme/tokens.css'), 'utf-8')
    assert.match(tokens, /:root\s*\{/, 'tokens.css should define :root custom properties')
    assert.match(tokens, /--color-bg:/, 'tokens.css should define background token')
    assert.match(tokens, /--space-\d+:/, 'tokens.css should define spacing tokens')

    const appShell = await readFile(join(desktopRoot, 'src/ui/components/AppShell.tsx'), 'utf-8')
    assert.match(appShell, /tokens\.css/, 'AppShell should import centralized tokens')
  })

  test('AC3: layout includes responsive behavior', async () => {
    const tokens = await readFile(join(desktopRoot, 'src/ui/theme/tokens.css'), 'utf-8')
    assert.match(tokens, /@media\s*\(max-width:\s*\d+px\)/, 'tokens.css should include narrow-window media query')

    const appShell = await readFile(join(desktopRoot, 'src/ui/components/AppShell.tsx'), 'utf-8')
    assert.match(appShell, /app-shell/, 'AppShell should render shell layout class')
  })

  test('AC4: accessibility basics are present in shell styling and structure', async () => {
    const appShell = await readFile(join(desktopRoot, 'src/ui/components/AppShell.tsx'), 'utf-8')
    assert.match(appShell, /<main/, 'AppShell should use main landmark')

    const sidebar = await readFile(join(desktopRoot, 'src/ui/components/Sidebar.tsx'), 'utf-8')
    assert.match(sidebar, /<nav/, 'Sidebar should use nav landmark')

    const tokens = await readFile(join(desktopRoot, 'src/ui/theme/tokens.css'), 'utf-8')
    assert.match(tokens, /:focus-visible/, 'tokens.css should style keyboard focus visibility')
  })
})
