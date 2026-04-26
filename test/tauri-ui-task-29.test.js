import assert from 'node:assert/strict'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 29: tauri desktop scaffold', () => {
  test('AC1: required scaffold files exist under interface/desktop', async () => {
    const requiredFiles = [
      'package.json',
      'src/main.tsx',
      'src/ui/routes/Home.tsx',
      'src-tauri/Cargo.toml',
      'src-tauri/src/main.rs',
      'src-tauri/tauri.conf.json'
    ]

    for (const relativePath of requiredFiles) {
      await fileExists(join(desktopRoot, relativePath))
    }
  })

  test('AC2: desktop package scripts include dev, build, and lint', async () => {
    const packageJsonPath = join(desktopRoot, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'))

    assert.equal(typeof packageJson.scripts?.dev, 'string', 'dev script must be present')
    assert.equal(typeof packageJson.scripts?.build, 'string', 'build script must be present')
    assert.equal(typeof packageJson.scripts?.lint, 'string', 'lint script must be present')

    assert.match(packageJson.scripts.lint, /tsc\s+--noEmit/, 'lint script should run TypeScript checks')
  })

  test('AC3: frontend entry renders Home route component', async () => {
    const mainTsx = await readFile(join(desktopRoot, 'src/main.tsx'), 'utf-8')
    assert.match(mainTsx, /createRoot\(/, 'main.tsx should use React createRoot')
    assert.match(mainTsx, /Home|AppShell/, 'main.tsx should render initial route or shell')

    const homeTsx = await readFile(join(desktopRoot, 'src/ui/routes/Home.tsx'), 'utf-8')
    assert.match(homeTsx, /home/i, 'home route should include visible home text')
  })

  test('AC4: rust bridge exposes health check command and does not expose generic execution', async () => {
    const mainRs = await readFile(join(desktopRoot, 'src-tauri/src/main.rs'), 'utf-8')
    const commandsRs = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')

    assert.match(commandsRs, /fn\s+health_check\s*\(/, 'health_check command must exist')

    const handlerMatch = mainRs.match(/generate_handler!\s*\[([^\]]*)\]/)
    assert.ok(handlerMatch, 'invoke handler should be defined')

    const registeredCommands = handlerMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    assert.ok(registeredCommands.includes('commands::health_check') || registeredCommands.includes('health_check'), 'health_check should be registered')
    assert.doesNotMatch(mainRs, /exec_command|run_command|shell_exec|command_passthrough/, 'generic execution endpoint should not be exposed')
  })
})
