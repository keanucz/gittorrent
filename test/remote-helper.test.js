import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'

import { createRemoteHelper } from '../lib/remote-helper.js'

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const SHA = 'a'.repeat(40)

const objectStoreMock = {
  has: async () => true,
  get: async () => null,
  put: async () => {}
}

const defaultIdentity = {
  publicKey: Buffer.alloc(32),
  sign: () => Buffer.alloc(64),
  verify: () => true
}

// ---------------------------------------------------------------------------
// Test session factory
// ---------------------------------------------------------------------------

async function createTestSession (repoMock, objectStoreMockOverride) {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks = []
  output.on('data', chunk => chunks.push(chunk))

  const sessionDone = createRemoteHelper({
    input,
    output,
    repo: repoMock,
    objectStore: objectStoreMockOverride ?? objectStoreMock,
    workingClonePath: '/tmp/fake-working-clone',
    identity: defaultIdentity
  })

  return {
    send: (str) => input.push(str),
    end: () => { input.push(null); return sessionDone },
    getOutput: () => Buffer.concat(chunks).toString()
  }
}

// Repo mocks
const emptyRepoMock = {
  view: { createReadStream: () => (async function * () {})() },
  getRef: async () => null
}

const repoWithRefs = {
  view: {
    createReadStream: () => (async function * () {
      yield { key: 'refs/heads/main', value: SHA }
      yield { key: 'HEAD', value: '@refs/heads/main' }
    })()
  },
  getRef: async (ref) => ref === 'HEAD' ? '@refs/heads/main' : SHA
}

const pushSuccessRepo = {
  updateRef: async (_ref, _oldSha, _newSha, _force) => ({ ok: true }),
  getRef: async () => null
}

const pushConflictRepo = {
  updateRef: async () => ({ ok: false, reason: 'non-fast-forward' }),
  getRef: async () => null
}

// ---------------------------------------------------------------------------
// Acceptance criteria tests
// ---------------------------------------------------------------------------

// 1. capabilities
test('capabilities: responds with "fetch\\npush\\noption\\n\\n"', async () => {
  const session = await createTestSession(emptyRepoMock)
  session.send('capabilities\n\n')
  await session.end()
  assert.equal(session.getOutput(), 'fetch\npush\noption\n\n')
})

// 2. list on empty repo
test('list: empty repo responds with exactly "\\n"', async () => {
  const session = await createTestSession(emptyRepoMock)
  session.send('list\n\n')
  await session.end()
  assert.equal(session.getOutput(), '\n')
})

// 3. list with one ref
test('list: repo with refs includes "<sha> refs/heads/main\\n" line', async () => {
  const session = await createTestSession(repoWithRefs)
  session.send('list\n\n')
  await session.end()
  const out = session.getOutput()
  assert.ok(
    out.includes(`${SHA} refs/heads/main\n`),
    `output did not contain sha+ref line; got: ${JSON.stringify(out)}`
  )
})

// 4. list with symbolic HEAD
test('list: repo with symbolic HEAD includes "@refs/heads/main HEAD\\n"', async () => {
  const session = await createTestSession(repoWithRefs)
  session.send('list\n\n')
  await session.end()
  const out = session.getOutput()
  assert.ok(
    out.includes('@refs/heads/main HEAD\n'),
    `output did not contain symbolic HEAD line; got: ${JSON.stringify(out)}`
  )
})

// 5. option verbosity
test('option verbosity 1: responds with "ok\\n"', async () => {
  const session = await createTestSession(emptyRepoMock)
  session.send('option verbosity 1\n\n')
  await session.end()
  assert.equal(session.getOutput(), 'ok\n')
})

// 6. option progress
test('option progress false: responds with "ok\\n"', async () => {
  const session = await createTestSession(emptyRepoMock)
  session.send('option progress false\n\n')
  await session.end()
  assert.equal(session.getOutput(), 'ok\n')
})

// 7. unknown option
test('option unknown foo: responds with "unsupported\\n"', async () => {
  const session = await createTestSession(emptyRepoMock)
  session.send('option unknown foo\n\n')
  await session.end()
  assert.equal(session.getOutput(), 'unsupported\n')
})

// 8. push success
test('push success: responds with "ok refs/heads/main\\n\\n"', async () => {
  const session = await createTestSession(pushSuccessRepo)
  session.send('push refs/heads/main:refs/heads/main\n\n')
  await session.end()
  assert.equal(session.getOutput(), 'ok refs/heads/main\n\n')
})

// 9. push conflict
test('push conflict: responds with "error refs/heads/main non-fast-forward\\n\\n"', async () => {
  const session = await createTestSession(pushConflictRepo)
  session.send('push refs/heads/main:refs/heads/main\n\n')
  await session.end()
  assert.equal(session.getOutput(), 'error refs/heads/main non-fast-forward\n\n')
})

// 10. force push calls updateRef with force=true
test('push with leading +: calls updateRef with force=true', async () => {
  let capturedForce
  const forcePushRepo = {
    updateRef: async (_ref, _oldSha, _newSha, force) => {
      capturedForce = force
      return { ok: true }
    },
    getRef: async () => null
  }

  const session = await createTestSession(forcePushRepo)
  session.send('push +refs/heads/main:refs/heads/main\n\n')
  await session.end()

  assert.equal(capturedForce, true, 'updateRef was not called with force=true')
})

// 11. push with empty src (delete)
test('push with empty src (delete): updateRef called with null/empty newSha or dedicated delete path', async () => {
  let updateRefCalled = false
  let capturedNewSha
  const deletePushRepo = {
    updateRef: async (_ref, _oldSha, newSha, _force) => {
      updateRefCalled = true
      capturedNewSha = newSha
      return { ok: true }
    },
    getRef: async () => SHA
  }

  const session = await createTestSession(deletePushRepo)
  session.send('push :refs/heads/main\n\n')
  await session.end()

  assert.equal(updateRefCalled, true, 'updateRef was not called for delete push')
  assert.ok(
    capturedNewSha === null || capturedNewSha === '' || capturedNewSha === undefined,
    `expected null/empty newSha for delete, got: ${JSON.stringify(capturedNewSha)}`
  )
})

// 12. No extra bytes on output — capabilities exact match (re-verified with strict equal)
test('output stream has no extra bytes beyond protocol: capabilities response is exactly "fetch\\npush\\noption\\n\\n"', async () => {
  const session = await createTestSession(emptyRepoMock)
  session.send('capabilities\n\n')
  await session.end()

  const raw = session.getOutput()
  const expected = 'fetch\npush\noption\n\n'
  assert.equal(raw.length, expected.length, `extra bytes on output; got ${raw.length} bytes, expected ${expected.length}`)
  assert.equal(raw, expected)
})

// 13. Session resolves when input stream ends
test('session resolves when input stream closes (stdin EOF)', async () => {
  const session = await createTestSession(emptyRepoMock)
  // End immediately with no commands
  const done = session.end()
  // Must be a Promise that resolves (not hangs)
  await assert.doesNotReject(done, 'session did not resolve after input stream ended')
})
