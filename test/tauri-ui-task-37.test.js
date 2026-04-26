import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'

const desktopRoot = join(process.cwd(), 'interface', 'desktop')

async function fileExists (path) {
  await access(path, fsConstants.F_OK)
}

describe('task 37: seeding controls, settings, and hardening', () => {
  test('AC1: seed controls show current state and session duration', async () => {
    await fileExists(join(desktopRoot, 'src/ui/routes/Seed.tsx'))

    const seedRoute = await readFile(join(desktopRoot, 'src/ui/routes/Seed.tsx'), 'utf-8')
    assert.match(seedRoute, /seed start|start seed|seed_stop|seed_start/i, 'seed route should expose start/stop controls')
    assert.match(seedRoute, /duration|session/i, 'seed route should display seed session duration')
    assert.match(seedRoute, /seed status|isSeeding|active/i, 'seed route should display current seeding state')
  })

  test('AC2: settings map to PEAR_GIT_* environment values', async () => {
    await fileExists(join(desktopRoot, 'src/ui/routes/Settings.tsx'))

    const settingsRoute = await readFile(join(desktopRoot, 'src/ui/routes/Settings.tsx'), 'utf-8')
    assert.match(settingsRoute, /PEAR_GIT_DATA_DIR/, 'settings should include PEAR_GIT_DATA_DIR')
    assert.match(settingsRoute, /PEAR_GIT_LOG_LEVEL/, 'settings should include PEAR_GIT_LOG_LEVEL')
    assert.match(settingsRoute, /PEAR_GIT_BOOTSTRAP_NODES/, 'settings should include PEAR_GIT_BOOTSTRAP_NODES')
    assert.match(settingsRoute, /PEAR_GIT_SEEDER_KEYS/, 'settings should include PEAR_GIT_SEEDER_KEYS')
    assert.match(settingsRoute, /PEAR_GIT_CONNECT_TIMEOUT/, 'settings should include PEAR_GIT_CONNECT_TIMEOUT')
  })

  test('AC3 and AC4: tauri config hardening and command allowlist audit', async () => {
    const tauriConf = await readFile(join(desktopRoot, 'src-tauri/tauri.conf.json'), 'utf-8')
    assert.match(tauriConf, /permissions|capabilities|security/i, 'tauri config should include explicit hardening configuration')

    const mainRs = await readFile(join(desktopRoot, 'src-tauri/src/main.rs'), 'utf-8')
    assert.match(mainRs, /seed_start|seed_stop|seed_status/, 'seed commands should be allowlisted')
    assert.doesNotMatch(mainRs, /exec_command|shell_exec|command_passthrough/, 'privileged generic command endpoints must not be allowlisted')
  })

  test('AC5: log verbosity can be changed without restart', async () => {
    const settingsRoute = await readFile(join(desktopRoot, 'src/ui/routes/Settings.tsx'), 'utf-8')
    assert.match(settingsRoute, /log level|verbosity/i, 'settings route should expose log level control')

    const commands = await readFile(join(desktopRoot, 'src-tauri/src/commands.rs'), 'utf-8')
    assert.match(commands, /set_log_level|settings_set/, 'backend should provide command to change log level at runtime')
  })
})
