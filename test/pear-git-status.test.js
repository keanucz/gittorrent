import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

// AC1: This import will fail with MODULE_NOT_FOUND because lib/commands/status.js does not exist yet.
// All tests in this file will be skipped/errored until that module is created.
import { run } from '../lib/commands/status.js'
import { CliError } from '../lib/commands/cli-error.js'

// ============================================================================
// Mock Factories
// ============================================================================

const KEY = Buffer.alloc(32, 1)

/**
 * Build a repo mock with a secrets key present (key version 2, 2 encrypted files).
 */
function makeRepoMockWithSecrets () {
  return {
    key: KEY,
    signedLength: 42,
    pendingLength: 1,
    getWriters: async () => [
      { key: Buffer.alloc(32, 1), indexer: true },
      { key: Buffer.alloc(32, 2), indexer: false }
    ],
    secretsView: {
      get: async (key) => {
        if (key === 'secrets-key-version') return { value: 2 }
        return null
      },
      createReadStream: () => {
        const entries = [
          { key: 'secrets-key/aabb' },
          { key: 'secrets-key/ccdd' }
        ]
        return {
          [Symbol.asyncIterator]: async function * () {
            for (const e of entries) yield e
          }
        }
      }
    },
    view: {
      sub: (_name) => ({
        createReadStream: () => ({
          // 0 rejections for baseline
          [Symbol.asyncIterator]: async function * () {}
        })
      })
    }
  }
}

/**
 * Build a repo mock with NO secrets key.
 */
function makeRepoMockNoSecrets () {
  return {
    key: KEY,
    signedLength: 42,
    pendingLength: 1,
    getWriters: async () => [
      { key: Buffer.alloc(32, 1), indexer: true },
      { key: Buffer.alloc(32, 2), indexer: false }
    ],
    secretsView: {
      get: async (_key) => null,
      createReadStream: () => ({
        [Symbol.asyncIterator]: async function * () {}
      })
    },
    view: {
      sub: (_name) => ({
        createReadStream: () => ({
          [Symbol.asyncIterator]: async function * () {}
        })
      })
    }
  }
}

/**
 * Build a repo mock with N rejected pushes in the rejections sub-bee.
 */
function makeRepoMockWithRejections (count) {
  const rejections = Array.from({ length: count }, (_, i) => ({ key: `rejection/${i}` }))
  return {
    key: KEY,
    signedLength: 42,
    pendingLength: 1,
    getWriters: async () => [
      { key: Buffer.alloc(32, 1), indexer: true }
    ],
    secretsView: {
      get: async (_key) => null,
      createReadStream: () => ({
        [Symbol.asyncIterator]: async function * () {}
      })
    },
    view: {
      sub: (_name) => ({
        createReadStream: () => ({
          [Symbol.asyncIterator]: async function * () {
            for (const r of rejections) yield r
          }
        })
      })
    }
  }
}

/** Default swarm mock: 3 connected peers. */
const swarmMock = {
  connectedPeers: (_key) => 3
}

/** Swarm mock with 0 peers. */
const swarmMockNoPeers = {
  connectedPeers: (_key) => 0
}

/**
 * Capture writes to an output stream.
 */
function makeOutput () {
  const chunks = []
  return {
    write: (s) => { chunks.push(s); return true },
    get text () { return chunks.join('') }
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('pear-git status', () => {
  // AC1: module-not-found — tested implicitly by the top-level import above.
  // If status.js does not exist, ALL tests in this file fail at module load time.
  test('AC1: run is exported as a function from lib/commands/status.js', () => {
    assert.equal(typeof run, 'function', 'run should be a function')
  })

  // AC2: output contains "Repo: pear://<hex key>"
  test('AC2: human output contains "Repo: pear://<key>" (hex of repo.key)', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    const expectedHex = KEY.toString('hex')
    assert.match(out.text, new RegExp(`Repo: pear://${expectedHex}`))
  })

  // AC3: output contains "Peers: <n> connected"
  test('AC3: human output contains "Peers: 3 connected"', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Peers: 3 connected/)
  })

  // AC4: output contains "Signed length: <n>"
  test('AC4: human output contains "Signed length: 42"', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Signed length: 42/)
  })

  // AC5: output contains "Pending ops: <n>"
  test('AC5: human output contains "Pending ops: 1" (pendingLength)', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Pending ops: 1/)
  })

  // AC6: output contains "Rejected pushes: <n>"
  test('AC6: human output contains "Rejected pushes: 0" when no rejections', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Rejected pushes: 0/)
  })

  test('AC6b: human output contains "Rejected pushes: 2" when two rejections exist', async () => {
    const repo = makeRepoMockWithRejections(2)
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Rejected pushes: 2/)
  })

  // AC7: output contains "Writers: <total> (<indexers> indexer)"
  test('AC7: human output contains "Writers: 2 (1 indexer)"', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Writers: 2 \(1 indexer\)/)
  })

  // AC8: output contains "Secrets: key v<n>, <m> files" when secrets key exists
  test('AC8: human output contains "Secrets: key v2, 2 files" when secrets key exists', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Secrets: key v2, 2 files/)
  })

  // AC9: output contains "Secrets: none" when no secrets key
  test('AC9: human output contains "Secrets: none" when no secrets key', async () => {
    const repo = makeRepoMockNoSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: swarmMock, output: out })

    assert.match(out.text, /Secrets: none/)
  })

  // AC10: --json outputs a single parseable JSON object
  test('AC10: --json flag outputs a single parseable JSON object', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run(['--json'], { repo, swarm: swarmMock, output: out })

    let parsed
    assert.doesNotThrow(() => {
      parsed = JSON.parse(out.text)
    }, 'output should be valid JSON')
    assert.equal(typeof parsed, 'object', 'parsed output should be an object')
  })

  // AC11: JSON output has all required fields
  test('AC11: JSON output has fields repoKey, peers, signedLength, pendingOps, rejectedPushes, writers, indexers, secrets', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run(['--json'], { repo, swarm: swarmMock, output: out })

    const parsed = JSON.parse(out.text)
    const requiredFields = ['repoKey', 'peers', 'signedLength', 'pendingOps', 'rejectedPushes', 'writers', 'indexers', 'secrets']
    for (const field of requiredFields) {
      assert.ok(field in parsed, `JSON output should have field: ${field}`)
    }
  })

  // AC11b: JSON field values are correct
  test('AC11b: JSON field values are correct for repo with secrets', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run(['--json'], { repo, swarm: swarmMock, output: out })

    const parsed = JSON.parse(out.text)
    assert.equal(parsed.repoKey, KEY.toString('hex'), 'repoKey should be hex of repo.key')
    assert.equal(parsed.peers, 3, 'peers should be 3')
    assert.equal(parsed.signedLength, 42, 'signedLength should be 42')
    assert.equal(parsed.pendingOps, 1, 'pendingOps should be 1')
    assert.equal(parsed.rejectedPushes, 0, 'rejectedPushes should be 0')
    assert.equal(parsed.writers, 2, 'writers should be 2')
    assert.equal(parsed.indexers, 1, 'indexers should be 1')
  })

  // AC12: secrets field in JSON is { keyVersion: 0, fileCount: 0, hasKey: false } when no secrets key
  test('AC12: JSON secrets field is { keyVersion: 0, fileCount: 0, hasKey: false } when no secrets key', async () => {
    const repo = makeRepoMockNoSecrets()
    const out = makeOutput()

    await run(['--json'], { repo, swarm: swarmMock, output: out })

    const parsed = JSON.parse(out.text)
    assert.deepEqual(parsed.secrets, { keyVersion: 0, fileCount: 0, hasKey: false })
  })

  // AC12b: secrets field in JSON has correct values when secrets key exists
  test('AC12b: JSON secrets field has correct values when secrets key exists (keyVersion: 2, fileCount: 2, hasKey: true)', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await run(['--json'], { repo, swarm: swarmMock, output: out })

    const parsed = JSON.parse(out.text)
    assert.deepEqual(parsed.secrets, { keyVersion: 2, fileCount: 2, hasKey: true })
  })

  // AC13: exit code 0 on success — run() resolves without throwing
  test('AC13: run() resolves without throwing on success (exit code 0)', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await assert.doesNotReject(
      () => run([], { repo, swarm: swarmMock, output: out }),
      'run() should not throw on success'
    )
  })

  // AC14: exit code 1 when not inside a pear-git repo — throws CliError with code 1
  test('AC14: throws CliError with code 1 when repo is null (not a pear-git repo)', async () => {
    const out = makeOutput()

    await assert.rejects(
      () => run([], { repo: null, swarm: swarmMock, output: out }),
      (error) => {
        assert.ok(error instanceof CliError, 'should throw CliError')
        assert.equal(error.code, 1, 'CliError.code should be 1')
        return true
      }
    )
  })

  // AC15: exit code 3 when no peers connected — throws CliError with code 3 but still writes local state
  test('AC15: throws CliError with code 3 when no peers connected, but still writes output', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await assert.rejects(
      () => run([], { repo, swarm: swarmMockNoPeers, output: out }),
      (error) => {
        assert.ok(error instanceof CliError, 'should throw CliError')
        assert.equal(error.code, 3, 'CliError.code should be 3')
        return true
      }
    )

    // Local state should still have been written before the throw
    assert.ok(out.text.length > 0, 'output should contain local state even when no peers')
  })

  test('AC15b: output still shows "Peers: 0 connected" before throwing CliError code 3', async () => {
    const repo = makeRepoMockWithSecrets()
    const out = makeOutput()

    await assert.rejects(
      () => run([], { repo, swarm: swarmMockNoPeers, output: out }),
      (error) => error instanceof CliError && error.code === 3
    )

    assert.match(out.text, /Peers: 0 connected/)
  })

  // AC16: all tests inject repo and swarm mocks — verified by the entire test suite design (no real Autobase/Hyperswarm used)
  test('AC16: injected repo and swarm mocks are used (no real Autobase or Hyperswarm)', async () => {
    // Verify that a custom mock swarm is actually consulted
    let swarmCalled = false
    const trackingSwarm = {
      connectedPeers: (key) => {
        swarmCalled = true
        assert.ok(Buffer.isBuffer(key), 'connectedPeers should be called with a Buffer key')
        return 5
      }
    }

    const repo = makeRepoMockNoSecrets()
    const out = makeOutput()

    await run([], { repo, swarm: trackingSwarm, output: out })

    assert.ok(swarmCalled, 'swarm.connectedPeers should have been called')
    assert.match(out.text, /Peers: 5 connected/)
  })
})
