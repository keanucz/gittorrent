import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import Corestore from 'corestore'
import { initRepo } from '../../lib/commands/init.js'
import { loadIdentity } from '../../lib/identity.js'
import { openRepo } from '../../lib/autobase-repo.js'
import bs58 from 'bs58'

const execFileAsync = promisify(execFile)
const BIN_DIR = join(process.cwd(), 'bin')

function makeEnv (dataDir) {
  return {
    ...process.env,
    PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH}`,
    PEAR_GIT_DATA_DIR: dataDir,
    PEAR_GIT_LOG_LEVEL: 'warn'
  }
}

async function withRepo (dataDir, repoUrl, identity, fn) {
  const repoKey = Buffer.from(bs58.decode(repoUrl.replace('pear://', '')))
  const storePath = join(dataDir, 'stores', bs58.encode(repoKey))
  const store = new Corestore(storePath)
  await store.ready()
  const repo = await openRepo(store, identity, { key: repoKey })
  try {
    return await fn(repo)
  } finally {
    await repo.close()
    await store.close()
  }
}

describe('e2e: clone-push-pull (single-peer)', { timeout: 60000 }, () => {
  let tmpDir
  let workDir
  let cloneDir
  let dataDir
  let repoUrl
  let env
  let identity

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pear-git-e2e-'))
    workDir = join(tmpDir, 'work')
    cloneDir = join(tmpDir, 'clone')
    dataDir = join(tmpDir, 'data')

    await mkdir(dataDir, { recursive: true })

    await execFileAsync('git', ['init', '-b', 'master', workDir])
    await execFileAsync('git', ['config', 'user.email', 'alice@example.com'], { cwd: workDir })
    await execFileAsync('git', ['config', 'user.name', 'Alice'], { cwd: workDir })
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial commit'], { cwd: workDir })

    const result = await initRepo({ cwd: workDir, dataDir })
    repoUrl = result.url

    identity = await loadIdentity(dataDir)
    env = makeEnv(dataDir)
  })

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('AC1: init creates a pear:// origin', async () => {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: workDir })
    assert.ok(stdout.trim().startsWith('pear://'), 'origin should be a pear:// URL')
  })

  test('AC2: push uploads objects and updates ref', async () => {
    await writeFile(join(workDir, 'file1.txt'), 'hello world')
    await execFileAsync('git', ['add', 'file1.txt'], { cwd: workDir })
    await execFileAsync('git', ['commit', '-m', 'add file1'], { cwd: workDir })

    await execFileAsync('git', ['push', 'origin', 'master'], { env, cwd: workDir, timeout: 20000 })

    const { stdout: localSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workDir })

    const remoteSha = await withRepo(dataDir, repoUrl, identity, async (repo) => {
      return repo.getRef('refs/heads/master')
    })

    assert.equal(remoteSha, localSha.trim(), 'remote ref should match local HEAD')
  })

  test('AC3: push uploads git objects to Autobase view', async () => {
    const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workDir })

    const hasObject = await withRepo(dataDir, repoUrl, identity, async (repo) => {
      return repo.hasObject(sha.trim())
    })

    assert.ok(hasObject, 'pushed commit object should exist in Autobase objectsView')
  })

  test('AC4: clone retrieves objects from Autobase store', async () => {
    await execFileAsync('git', ['clone', repoUrl, cloneDir], { env, timeout: 20000 })

    const { stdout: origSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workDir })
    const { stdout: cloneSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: cloneDir })
    assert.equal(origSha.trim(), cloneSha.trim(), 'clone HEAD should match origin')

    const content = await readFile(join(cloneDir, 'file1.txt'), 'utf-8')
    assert.equal(content, 'hello world', 'cloned file content should match')
  })

  test('AC5: second push updates ref correctly', async () => {
    await writeFile(join(workDir, 'file2.txt'), 'second file')
    await execFileAsync('git', ['add', 'file2.txt'], { cwd: workDir })
    await execFileAsync('git', ['commit', '-m', 'add file2'], { cwd: workDir })

    await execFileAsync('git', ['push', 'origin', 'master'], { env, cwd: workDir, timeout: 20000 })

    const { stdout: localSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workDir })

    const remoteSha = await withRepo(dataDir, repoUrl, identity, async (repo) => {
      return repo.getRef('refs/heads/master')
    })

    assert.equal(remoteSha, localSha.trim())
  })

  test('AC6: pull from clone retrieves new commit', async () => {
    await execFileAsync('git', ['pull', '--rebase', 'origin', 'master'], { env, cwd: cloneDir, timeout: 20000 })

    const { stdout: origSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workDir })
    const { stdout: cloneSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: cloneDir })
    assert.equal(origSha.trim(), cloneSha.trim())

    const content = await readFile(join(cloneDir, 'file2.txt'), 'utf-8')
    assert.equal(content, 'second file')
  })

  test('AC7: non-fast-forward push rejected', async () => {
    await execFileAsync('git', ['config', 'user.email', 'bob@example.com'], { cwd: cloneDir })
    await execFileAsync('git', ['config', 'user.name', 'Bob'], { cwd: cloneDir })

    await writeFile(join(workDir, 'divergeA.txt'), 'A content')
    await execFileAsync('git', ['add', 'divergeA.txt'], { cwd: workDir })
    await execFileAsync('git', ['commit', '-m', 'diverge A'], { cwd: workDir })
    await execFileAsync('git', ['push', 'origin', 'master'], { env, cwd: workDir, timeout: 20000 })

    await writeFile(join(cloneDir, 'divergeB.txt'), 'B content')
    await execFileAsync('git', ['add', 'divergeB.txt'], { cwd: cloneDir })
    await execFileAsync('git', ['commit', '-m', 'diverge B'], { cwd: cloneDir })

    await assert.rejects(
      () => execFileAsync('git', ['push', 'origin', 'master'], { env, cwd: cloneDir, timeout: 20000 }),
      (err) => {
        const combined = (err.stderr || '') + (err.stdout || '')
        return combined.includes('non-fast-forward') ||
               combined.includes('rejected') ||
               err.code !== 0
      },
      'Diverged push should fail'
    )
  })

  test('AC8: addWriter/getWriters round-trip', async () => {
    const writerKey = Buffer.alloc(32)
    writerKey[0] = 0xAB

    await withRepo(dataDir, repoUrl, identity, async (repo) => {
      await repo.addWriter(writerKey, false)
      const writers = await repo.getWriters()
      const found = writers.find(w => w.key.equals(writerKey))
      assert.ok(found, 'added writer should appear in getWriters()')
    })
  })

  test('AC9: offline reads - local git history available', async () => {
    const { stdout } = await execFileAsync('git', ['log', '--oneline'], { cwd: workDir, timeout: 5000 })
    assert.ok(stdout.includes('initial commit'))
    assert.ok(stdout.includes('add file1'))
  })
})
