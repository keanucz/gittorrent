import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sodium from 'sodium-native'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import RAM from 'random-access-memory'

// Target module — does NOT exist yet. Import triggers ERR_MODULE_NOT_FOUND.
import { runAdd, runGet, runList, runRm, runRotate } from '../lib/commands/secrets.js'

import { CliError } from '../lib/commands/cli-error.js'

// ============================================================================
// Helpers
// ============================================================================

function makeDb (valueEncoding = 'binary') {
  const core = new Hypercore(RAM)
  return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding })
}

/**
 * Build a real identity with working crypto and a matching secretsView mock
 * that returns a pre-built envelope at the expected key path.
 */
function makeIdentityAndSecretsView () {
  const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)

  const secretsKey = Buffer.alloc(32, 0xAB)

  const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, publicKey)
  const encryptedKey = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(encryptedKey, secretsKey, x25519Pub)

  const identity = {
    publicKey,
    openKeyEnvelope (enc) {
      const x25519Secret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
      sodium.crypto_sign_ed25519_sk_to_curve25519(x25519Secret, secretKey)
      const out = Buffer.allocUnsafe(enc.length - sodium.crypto_box_SEALBYTES)
      return sodium.crypto_box_seal_open(out, enc, x25519Pub, x25519Secret) ? out : null
    }
  }

  const secretsView = {
    async get (key) {
      if (key === 'secrets-key/' + publicKey.toString('hex')) {
        return { value: { encryptedKey: encryptedKey.toString('hex'), keyVersion: 1 } }
      }
      if (key === 'secrets-key-version') return { value: 1 }
      return null
    }
  }

  return { identity, secretsView, secretsKey }
}

/** secretsView that reports no key envelope and keyVersion === 0 */
function makeNoKeySecretsView () {
  return {
    async get () { return null }
  }
}

function makeStreams () {
  let out = ''
  let err = ''
  return {
    stdout: { write: s => { out += s } },
    stderr: { write: s => { err += s } },
    getOut: () => out,
    getErr: () => err
  }
}

/**
 * Encode a secrets-db entry value: keyVersion(4B LE) + nonce(24B) + ciphertext.
 */
function encodeDbValue (keyVersion, nonce, ciphertext) {
  const buf = Buffer.allocUnsafe(4 + nonce.length + ciphertext.length)
  buf.writeUInt32LE(keyVersion, 0)
  nonce.copy(buf, 4)
  ciphertext.copy(buf, 4 + nonce.length)
  return buf
}

/**
 * Encrypt plaintext with secretsKey and write directly into a Hyperbee, bypassing
 * runAdd. Useful for setting up state for runGet / runList / runRm / runRotate tests.
 */
async function writeSecretEntry (db, storePath, plaintext, secretsKey, keyVersion = 1) {
  const nonce = Buffer.allocUnsafe(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const ciphertext = Buffer.allocUnsafe(plaintext.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, secretsKey)
  const value = encodeDbValue(keyVersion, nonce, ciphertext)
  await db.put(storePath, value)
}

// ============================================================================
// Test Suite: runAdd
// ============================================================================

describe('pear-git secrets add', () => {
  test('1: reads and stores a file, stdout reports Added <path> (key version: 1)', async () => {
    const { identity, secretsView } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()
    const ops = []
    const repo = {
      secretsView,
      appendOp: async (op) => { ops.push(op) },
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    // Write a temp file to add
    const tmpFile = path.join(os.tmpdir(), `pear-git-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'hello secrets')
    try {
      await runAdd([tmpFile], { repo, identity, secretsDb, streams })

      assert.match(streams.getOut(), /Added .+ \(key version: 1\)\n/)
      // Entry should exist in secretsDb under the file's basename
      const storePath = path.basename(tmpFile)
      const entry = await secretsDb.get(storePath)
      assert.ok(entry, 'entry should exist in secretsDb')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('2: --name config/.env stores under that key path', async () => {
    const { identity, secretsView } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()
    const ops = []
    const repo = {
      secretsView,
      appendOp: async (op) => { ops.push(op) },
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    const tmpFile = path.join(os.tmpdir(), `pear-git-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'content')
    try {
      await runAdd([tmpFile, '--name', 'config/.env'], { repo, identity, secretsDb, streams })

      assert.match(streams.getOut(), /Added config\/\.env \(key version: 1\)\n/)
      const entry = await secretsDb.get('config/.env')
      assert.ok(entry, 'entry should exist under config/.env')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('3: first add when keyVersion=0 generates key and appends secrets-key-envelope op for self', async () => {
    const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, publicKey)

    // No envelope exists yet — keyVersion is 0
    const secretsView = makeNoKeySecretsView()

    const identity = {
      publicKey,
      openKeyEnvelope (enc) {
        const x25519Secret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
        sodium.crypto_sign_ed25519_sk_to_curve25519(x25519Secret, secretKey)
        const out = Buffer.allocUnsafe(enc.length - sodium.crypto_box_SEALBYTES)
        return sodium.crypto_box_seal_open(out, enc, x25519Pub, x25519Secret) ? out : null
      }
    }

    const secretsDb = makeDb()
    await secretsDb.ready()
    const ops = []
    const repo = {
      secretsView,
      appendOp: async (op) => { ops.push(op) },
      getWriters: async () => [{ key: publicKey, indexer: true }]
    }
    const streams = makeStreams()

    const tmpFile = path.join(os.tmpdir(), `pear-git-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'bootstrap')
    try {
      await runAdd([tmpFile], { repo, identity, secretsDb, streams })

      // An envelope op should have been appended
      const envelopeOp = ops.find(o => o.op === 'secrets-key-envelope')
      assert.ok(envelopeOp, 'secrets-key-envelope op should be appended on first add')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('4: path with .. component exits 2', async () => {
    const { identity, secretsView } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()
    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    const tmpFile = path.join(os.tmpdir(), `pear-git-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'data')
    try {
      await assert.rejects(
        () => runAdd([tmpFile, '--name', '../etc/passwd'], { repo, identity, secretsDb, streams }),
        (err) => {
          assert.ok(err instanceof CliError, 'should throw CliError')
          assert.equal(err.code, 2, 'should exit with code 2')
          return true
        }
      )
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('5: path exceeding 255 chars exits 2', async () => {
    const { identity, secretsView } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()
    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    const tmpFile = path.join(os.tmpdir(), `pear-git-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'data')
    const longPath = 'a'.repeat(256)
    try {
      await assert.rejects(
        () => runAdd([tmpFile, '--name', longPath], { repo, identity, secretsDb, streams }),
        (err) => {
          assert.ok(err instanceof CliError, 'should throw CliError')
          assert.equal(err.code, 2, 'should exit with code 2')
          return true
        }
      )
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('6: no secrets key envelope available exits 2', async () => {
    const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    // identity that cannot open any envelope (always returns null)
    const identity = {
      publicKey,
      openKeyEnvelope: () => null
    }

    // secretsView that claims a key exists but the identity can't open it
    const secretsView = {
      async get (key) {
        if (key === 'secrets-key/' + publicKey.toString('hex')) {
          return { value: { encryptedKey: Buffer.alloc(80).toString('hex'), keyVersion: 1 } }
        }
        if (key === 'secrets-key-version') return { value: 1 }
        return null
      }
    }

    const secretsDb = makeDb()
    await secretsDb.ready()
    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => []   // not a writer either
    }
    const streams = makeStreams()

    const tmpFile = path.join(os.tmpdir(), `pear-git-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'data')
    try {
      await assert.rejects(
        () => runAdd([tmpFile], { repo, identity, secretsDb, streams }),
        (err) => {
          assert.ok(err instanceof CliError, 'should throw CliError')
          assert.equal(err.code, 2, 'should exit with code 2')
          return true
        }
      )
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})

// ============================================================================
// Test Suite: runGet
// ============================================================================

describe('pear-git secrets get', () => {
  test('7: decrypts and writes plaintext to stdout', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    await writeSecretEntry(secretsDb, '.env', Buffer.from('MY_SECRET=hello'), secretsKey, 1)

    const repo = { secretsView }
    const streams = makeStreams()

    await runGet(['.env'], { repo, identity, secretsDb, streams })

    assert.equal(streams.getOut(), 'MY_SECRET=hello')
  })

  test('8: --output <path> writes plaintext to file', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    await writeSecretEntry(secretsDb, '.env', Buffer.from('SECRET=world'), secretsKey, 1)

    const repo = { secretsView }
    const streams = makeStreams()
    const outFile = path.join(os.tmpdir(), `pear-git-get-${Date.now()}.txt`)

    try {
      await runGet(['.env', '--output', outFile], { repo, identity, secretsDb, streams })

      const written = fs.readFileSync(outFile)
      assert.equal(written.toString(), 'SECRET=world')
    } finally {
      try { fs.unlinkSync(outFile) } catch { /* ignore cleanup error */ }
    }
  })

  test('9: non-existent path exits 2 with error message', async () => {
    const { identity, secretsView } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    const repo = { secretsView }
    const streams = makeStreams()

    await assert.rejects(
      () => runGet(['nonexistent.txt'], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )

    assert.match(streams.getErr(), /secret not found: nonexistent\.txt/)
  })

  test('10: key version mismatch exits 2 with rotation-in-progress message', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    // Store entry with keyVersion=2 but secretsView returns keyVersion=1
    await writeSecretEntry(secretsDb, '.env', Buffer.from('data'), secretsKey, 2)

    const repo = { secretsView }  // secretsView reports keyVersion=1
    const streams = makeStreams()

    await assert.rejects(
      () => runGet(['.env'], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )

    assert.match(streams.getErr(), /key version mismatch.*rotation in progress.*retry/i)
  })

  test('11: no secrets key exits 2', async () => {
    const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    const identity = {
      publicKey,
      openKeyEnvelope: () => null
    }
    const secretsView = makeNoKeySecretsView()

    const secretsDb = makeDb()
    await secretsDb.ready()
    // Write something so path-exists check passes, but key retrieval fails
    await secretsDb.put('.env', Buffer.alloc(40))

    const repo = { secretsView }
    const streams = makeStreams()

    await assert.rejects(
      () => runGet(['.env'], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )
  })
})

// ============================================================================
// Test Suite: runList
// ============================================================================

describe('pear-git secrets list', () => {
  test('12: empty store produces no output', async () => {
    const { identity, secretsView } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    const repo = { secretsView }
    const streams = makeStreams()

    await runList([], { repo, identity, secretsDb, streams })

    assert.equal(streams.getOut().trim(), '')
  })

  test('13: two secrets produce two lines on stdout', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    await writeSecretEntry(secretsDb, '.env', Buffer.from('a'), secretsKey)
    await writeSecretEntry(secretsDb, 'config/api.key', Buffer.from('b'), secretsKey)

    const repo = { secretsView }
    const streams = makeStreams()

    await runList([], { repo, identity, secretsDb, streams })

    const lines = streams.getOut().trim().split('\n').filter(Boolean)
    assert.equal(lines.length, 2, 'should produce exactly 2 lines')
    assert.ok(lines.includes('.env'), 'should include .env')
    assert.ok(lines.includes('config/api.key'), 'should include config/api.key')
  })

  test('14: --json flag produces a JSON array of paths', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    await writeSecretEntry(secretsDb, '.env', Buffer.from('a'), secretsKey)
    await writeSecretEntry(secretsDb, 'token', Buffer.from('b'), secretsKey)

    const repo = { secretsView }
    const streams = makeStreams()

    await runList(['--json'], { repo, identity, secretsDb, streams })

    const parsed = JSON.parse(streams.getOut())
    assert.ok(Array.isArray(parsed), 'output should be a JSON array')
    assert.equal(parsed.length, 2)
    assert.ok(parsed.includes('.env'))
    assert.ok(parsed.includes('token'))
  })

  test('15: no secrets key available exits 2', async () => {
    const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    const identity = {
      publicKey,
      openKeyEnvelope: () => null
    }
    const secretsView = makeNoKeySecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    const repo = { secretsView }
    const streams = makeStreams()

    await assert.rejects(
      () => runList([], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )
  })
})

// ============================================================================
// Test Suite: runRm
// ============================================================================

describe('pear-git secrets rm', () => {
  test('16: deletes entry and prints Removed <path>', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    await writeSecretEntry(secretsDb, '.env', Buffer.from('data'), secretsKey)

    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    await runRm(['.env'], { repo, identity, secretsDb, streams })

    assert.match(streams.getOut(), /Removed \.env\n/)
    const entry = await secretsDb.get('.env')
    assert.ok(entry === null || entry === undefined, 'entry should be deleted from secretsDb')
  })

  test('17: non-existent path exits 2', async () => {
    const { identity, secretsView } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    await assert.rejects(
      () => runRm(['nonexistent.txt'], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )
  })

  test('18: caller has no secrets key exits 2', async () => {
    const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    const identity = {
      publicKey,
      openKeyEnvelope: () => null
    }
    const secretsView = makeNoKeySecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()
    await secretsDb.put('.env', Buffer.alloc(40))

    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => []
    }
    const streams = makeStreams()

    await assert.rejects(
      () => runRm(['.env'], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )
  })
})

// ============================================================================
// Test Suite: runRotate
// ============================================================================

describe('pear-git secrets rotate', () => {
  test('19: rotates key, re-encrypts files, stdout reports new version and file count', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    await writeSecretEntry(secretsDb, '.env', Buffer.from('MY_SECRET=abc'), secretsKey, 1)

    const ops = []
    const repo = {
      secretsView,
      appendOp: async (op) => { ops.push(op) },
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    await runRotate([], { repo, identity, secretsDb, streams })

    assert.match(streams.getOut(), /Rotated to key version 2\. Re-encrypted 1 files?\.\n/)
  })

  test('20: appends secrets-key-rotate op and secrets-key-envelope ops per writer', async () => {
    const { identity, secretsView, secretsKey } = makeIdentityAndSecretsView()
    const secretsDb = makeDb()
    await secretsDb.ready()

    await writeSecretEntry(secretsDb, '.env', Buffer.from('data'), secretsKey, 1)

    const ops = []
    const repo = {
      secretsView,
      appendOp: async (op) => { ops.push(op) },
      getWriters: async () => [{ key: identity.publicKey, indexer: true }]
    }
    const streams = makeStreams()

    await runRotate([], { repo, identity, secretsDb, streams })

    const rotateOp = ops.find(o => o.op === 'secrets-key-rotate')
    assert.ok(rotateOp, 'secrets-key-rotate op should be appended')

    const envelopeOps = ops.filter(o => o.op === 'secrets-key-envelope')
    assert.ok(envelopeOps.length >= 1, 'at least one secrets-key-envelope op should be appended per writer')
  })

  test('21: non-indexer caller exits 2', async () => {
    const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, publicKey)
    const dummyKey = Buffer.alloc(32, 0xAB)
    const encryptedKey = Buffer.allocUnsafe(dummyKey.length + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(encryptedKey, dummyKey, x25519Pub)

    const identity = {
      publicKey,
      openKeyEnvelope (enc) {
        const x25519Secret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
        sodium.crypto_sign_ed25519_sk_to_curve25519(x25519Secret, secretKey)
        const out = Buffer.allocUnsafe(enc.length - sodium.crypto_box_SEALBYTES)
        return sodium.crypto_box_seal_open(out, enc, x25519Pub, x25519Secret) ? out : null
      }
    }

    const secretsView = {
      async get (key) {
        if (key === 'secrets-key/' + publicKey.toString('hex')) {
          return { value: { encryptedKey: encryptedKey.toString('hex'), keyVersion: 1 } }
        }
        if (key === 'secrets-key-version') return { value: 1 }
        return null
      }
    }

    const secretsDb = makeDb()
    await secretsDb.ready()

    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => [{ key: publicKey, indexer: false }]  // non-indexer
    }
    const streams = makeStreams()

    await assert.rejects(
      () => runRotate([], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )
  })

  test('22: no secrets key yet (keyVersion=0) exits 2', async () => {
    const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    const identity = {
      publicKey,
      openKeyEnvelope: () => null
    }
    const secretsView = makeNoKeySecretsView()

    const secretsDb = makeDb()
    await secretsDb.ready()

    const repo = {
      secretsView,
      appendOp: async () => {},
      getWriters: async () => [{ key: publicKey, indexer: true }]
    }
    const streams = makeStreams()

    await assert.rejects(
      () => runRotate([], { repo, identity, secretsDb, streams }),
      (err) => {
        assert.ok(err instanceof CliError, 'should throw CliError')
        assert.equal(err.code, 2, 'should exit with code 2')
        return true
      }
    )
  })
})
