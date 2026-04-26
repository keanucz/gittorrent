import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat, access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initRepo } from '../lib/commands/init.js'

const exec = promisify(execFile)

describe('gittorrent init', () => {
  let tmpCwd
  let tmpDataDir

  beforeEach(async () => {
    // Create separate temp directories for git repo and data storage
    tmpCwd = await mkdtemp(join(tmpdir(), 'gittorrent-init-cwd-'))
    tmpDataDir = await mkdtemp(join(tmpdir(), 'gittorrent-init-data-'))

    // Initialize git repo with an empty commit
    await exec('git', ['init'], { cwd: tmpCwd })
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpCwd })
    await exec('git', ['config', 'user.name', 'Test User'], { cwd: tmpCwd })
    await exec('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: tmpCwd })
  })

  afterEach(async () => {
    // Clean up temp directories
    if (tmpCwd) {
      await rm(tmpCwd, { recursive: true, force: true }).catch(() => {})
    }
    if (tmpDataDir) {
      await rm(tmpDataDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('AC1: initRepo is a function exported from lib/commands/init.js', () => {
    assert.equal(typeof initRepo, 'function', 'initRepo should be a function')
  })

  test('AC2: initRepo({ cwd, dataDir }) resolves without throwing', async () => {
    const result = await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    assert.ok(result, 'initRepo should return a result')
  })

  test('AC3: returned .url matches /^pear:\\/\\/[A-Za-z0-9]+$/ (base58 alphabet)', async () => {
    const { url } = await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    assert.match(url, /^gittorrent:\/\/[A-Za-z0-9]+$/, 'URL should be gittorrent:// followed by base58 characters')
  })

  test('AC4: after init, git remote get-url origin equals the returned URL', async () => {
    const { url } = await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: tmpCwd })
    assert.equal(stdout.trim(), url, 'git remote origin should match returned URL')
  })

  test('AC5: .gitignore exists after init', async () => {
    await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    const gitignorePath = join(tmpCwd, '.gitignore')
    await access(gitignorePath) // throws if file does not exist
    const stats = await stat(gitignorePath)
    assert.ok(stats.isFile(), '.gitignore should be a file')
  })

  test('AC6: .gitignore contains required secret patterns', async () => {
    await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    const gitignorePath = join(tmpCwd, '.gitignore')
    const content = await readFile(gitignorePath, 'utf-8')

    const requiredPatterns = ['.env', '.env.*', '*.pem', '*.key', 'secrets/']
    for (const pattern of requiredPatterns) {
      assert.ok(
        content.includes(pattern),
        `.gitignore should contain pattern: ${pattern}`
      )
    }
  })

  test('AC7: if .gitignore already exists, patterns are APPENDED (preserve original lines)', async () => {
    const gitignorePath = join(tmpCwd, '.gitignore')
    const originalContent = '# Original content\nnode_modules/\n*.log\n'

    // Write existing .gitignore before init
    await writeFile(gitignorePath, originalContent, 'utf-8')

    await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })

    const newContent = await readFile(gitignorePath, 'utf-8')

    // Original lines must still be present
    assert.ok(newContent.includes('# Original content'), 'should preserve original comment')
    assert.ok(newContent.includes('node_modules/'), 'should preserve original patterns')
    assert.ok(newContent.includes('*.log'), 'should preserve original patterns')

    // New patterns must be appended
    const requiredPatterns = ['.env', '.env.*', '*.pem', '*.key', 'secrets/']
    for (const pattern of requiredPatterns) {
      assert.ok(
        newContent.includes(pattern),
        `.gitignore should contain appended pattern: ${pattern}`
      )
    }
  })

  test('AC8: calling initRepo twice in the same cwd rejects (origin already set)', async () => {
    // First call succeeds
    await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })

    // Second call should reject because origin is already set to gittorrent://...
    await assert.rejects(
      () => initRepo({ cwd: tmpCwd, dataDir: tmpDataDir }),
      (err) => {
        assert.ok(err instanceof Error, 'should throw an Error')
        assert.ok(
          err.message.includes('origin') || err.message.includes('already'),
          `error message should mention origin or already initialized, got: ${err.message}`
        )
        return true
      }
    )
  })

  test('AC9: returned URL starts with gittorrent://', async () => {
    const { url } = await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    assert.ok(url.startsWith('gittorrent://'), 'URL should start with gittorrent://')
  })

  test('AC10: after init, dataDir/identity file exists', async () => {
    await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    const identityPath = join(tmpDataDir, 'identity')
    const stats = await stat(identityPath)
    assert.ok(stats.isFile(), 'identity file should exist in dataDir')
  })

  test('AC11: after init, a directory exists at dataDir/stores/<base58KeyFromUrl>', async () => {
    const { url } = await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })

    // Extract base58 key from gittorrent:// URL
    const base58Key = url.replace(/^gittorrent:\/\//, '')
    assert.ok(base58Key.length > 0, 'base58 key should be extracted from URL')

    const storePath = join(tmpDataDir, 'stores', base58Key)
    const stats = await stat(storePath)
    assert.ok(stats.isDirectory(), `Corestore directory should exist at ${storePath}`)
  })

  test('AC12: --name <alias> option accepted without error', async () => {
    const result = await initRepo({
      cwd: tmpCwd,
      dataDir: tmpDataDir,
      name: 'my-test-repo'
    })

    assert.ok(result, 'initRepo should accept name option')
    assert.ok(result.url, 'initRepo should still return a URL when name is provided')
    assert.match(result.url, /^gittorrent:\/\/[A-Za-z0-9]+$/, 'URL should still be valid with name option')
  })

  test('AC13: initRepo resolves with an object containing url property', async () => {
    const result = await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })

    assert.ok(typeof result === 'object', 'result should be an object')
    assert.ok('url' in result, 'result should have a url property')
    assert.equal(typeof result.url, 'string', 'url should be a string')
  })

  test('AC14: URL key is valid base58 (no ambiguous characters 0OIl)', async () => {
    const { url } = await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    const key = url.replace(/^gittorrent:\/\//, '')

    // Base58 alphabet excludes 0, O, I, l
    const base58Alphabet = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/
    assert.match(key, base58Alphabet, 'key should use base58 alphabet (no 0OIl)')
  })

  test('AC15: after init, identity file is mode 0600', async () => {
    await initRepo({ cwd: tmpCwd, dataDir: tmpDataDir })
    const identityPath = join(tmpDataDir, 'identity')
    const stats = await stat(identityPath)
    const mode = stats.mode & 0o777

    assert.equal(mode, 0o600, `identity file should have mode 0600, got ${mode.toString(8)}`)
  })
})
