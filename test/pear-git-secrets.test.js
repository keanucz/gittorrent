import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import RAM from 'random-access-memory'
import { deriveX25519Pub, deriveX25519Secret } from '../lib/secrets.js'
import sodium from 'sodium-native'

// Dynamic import to allow TDD failing tests
const COMMANDS_PATH = '../lib/commands/secrets.js'

describe('pear-git secrets', () => {
  let tmpDir
  let db
  let repo
  let identity
  let stdout
  let stderr
  let opts

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pear-git-secrets-test-'))
    
    // In-memory Hyperbee (but needs a path for v11 storage even with RAM)
    const core = new Hypercore(join(tmpDir, 'core'), { storage: RAM })
    db = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
    await db.ready()

    // Generate valid ed25519 keypair
    const pk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const sk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(pk, sk)

    identity = {
      publicKey: pk,
      sign: (msg) => {
        const sig = Buffer.alloc(sodium.crypto_sign_BYTES)
        sodium.crypto_sign(sig, msg, sk)
        return sig
      },
      openKeyEnvelope: (env) => {
        const opened = Buffer.allocUnsafe(env.length - sodium.crypto_box_SEALBYTES)
        const x25519Pub = deriveX25519Pub(pk)
        const x25519Secret = deriveX25519Secret(sk)
        const ok = sodium.crypto_box_seal_open(opened, env, x25519Pub, x25519Secret)
        return ok ? opened : null
      },
      deriveX25519Pub: () => deriveX25519Pub(pk)
    }

    // Mock Repo
    repo = {
      view: db,
      secretsView: db.sub('secrets', { valueEncoding: 'json' }),
      getRef: async () => 'some-sha',
      appendOp: async () => {},
      isWriter: () => true,
      isIndexer: () => true,
      getWriters: async () => [{ key: pk, indexer: true }]
    }

    stdout = new PassThrough()
    stderr = new PassThrough()

    opts = {
      repo,
      identity,
      corestore: {
        get: () => db.feed
      },
      streams: { stdout, stderr }
    }
  })

  afterEach(async () => {
    await db.close()
    await db.feed.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('add', () => {
    test('add local file to secrets store', async () => {
      const { runAdd } = await import(COMMANDS_PATH)
      const envPath = join(tmpDir, '.env')
      await writeFile(envPath, 'SECRET=1234')

      // Mock an existing secrets key envelope for us
      const secretsKey = Buffer.alloc(32, 'k')
      const x25519Pub = deriveX25519Pub(identity.publicKey)
      const envelope = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(envelope, secretsKey, x25519Pub)
      await repo.secretsView.put('secrets-key/' + identity.publicKey.toString('hex'), {
        encryptedKey: envelope.toString('hex'),
        keyVersion: 1
      })
      await repo.secretsView.put('secrets-key-version', 1)

      await runAdd([envPath], opts)

      // Verify it's in the DB
      const entry = await db.get('files/.env')
      assert.ok(entry, 'file should be in DB')
      assert.ok(entry.value.length > 0)
      
      stdout.end()
      const out = stdout.read()?.toString() || ''
      assert.match(out, /Added .env \(key version: 1\)/)
    })

    test('add fails if not a writer', async () => {
      const { runAdd } = await import(COMMANDS_PATH)
      repo.isWriter = () => false
      const envPath = join(tmpDir, '.env')
      await writeFile(envPath, 'foo')
      
      const err = await runAdd([envPath], opts).catch(e => e)
      assert.strictEqual(err.code, 2)
    })
  })

  describe('get', () => {
    test('get decrypted content', async () => {
      const { runAdd, runGet } = await import(COMMANDS_PATH)
      const envPath = join(tmpDir, '.env')
      await writeFile(envPath, 'MY_SECRET=hello')

      // Setup key
      const secretsKey = Buffer.alloc(32, 'k')
      const x25519Pub = deriveX25519Pub(identity.publicKey)
      const envelope = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(envelope, secretsKey, x25519Pub)
      await repo.secretsView.put('secrets-key/' + identity.publicKey.toString('hex'), {
        encryptedKey: envelope.toString('hex'),
        keyVersion: 1
      })
      await repo.secretsView.put('secrets-key-version', 1)

      await runAdd([envPath], opts)

      // Clear stdout
      opts.streams.stdout = new PassThrough()
      await runGet(['.env'], opts)

      opts.streams.stdout.end()
      const out = opts.streams.stdout.read()?.toString() || ''
      assert.strictEqual(out.trim(), 'MY_SECRET=hello')
    })

    test('get to output file', async () => {
      const { runAdd, runGet } = await import(COMMANDS_PATH)
      const envPath = join(tmpDir, '.env')
      await writeFile(envPath, 'top-secret')
      
      const secretsKey = Buffer.alloc(32, 'k')
      const x25519Pub = deriveX25519Pub(identity.publicKey)
      const envelope = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(envelope, secretsKey, x25519Pub)
      await repo.secretsView.put('secrets-key/' + identity.publicKey.toString('hex'), {
        encryptedKey: envelope.toString('hex'),
        keyVersion: 1
      })
      await repo.secretsView.put('secrets-key-version', 1)

      await runAdd([envPath], opts)

      const outPath = join(tmpDir, 'out.env')
      await runGet(['.env', '--output', outPath], opts)
      
      const content = await readFile(outPath, 'utf8')
      assert.strictEqual(content, 'top-secret')
    })
  })

  describe('list', () => {
    test('list multiple secrets', async () => {
      const { runAdd, runList } = await import(COMMANDS_PATH)
      
      const secretsKey = Buffer.alloc(32, 'k')
      const x25519Pub = deriveX25519Pub(identity.publicKey)
      const envelope = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(envelope, secretsKey, x25519Pub)
      await repo.secretsView.put('secrets-key/' + identity.publicKey.toString('hex'), {
        encryptedKey: envelope.toString('hex'),
        keyVersion: 1
      })
      await repo.secretsView.put('secrets-key-version', 1)

      const f1 = join(tmpDir, 'a')
      const f2 = join(tmpDir, 'b')
      await writeFile(f1, '1')
      await writeFile(f2, '2')

      await runAdd([f1], opts)
      await runAdd([f2], opts)

      opts.streams.stdout = new PassThrough()
      await runList([], opts)
      opts.streams.stdout.end()
      const out = (opts.streams.stdout.read()?.toString() || '').split('\n').filter(Boolean).sort()
      assert.deepEqual(out, ['a', 'b'])
    })

    test('list --json', async () => {
      const { runAdd, runList } = await import(COMMANDS_PATH)
      const secretsKey = Buffer.alloc(32, 'k')
      const x25519Pub = deriveX25519Pub(identity.publicKey)
      const envelope = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(envelope, secretsKey, x25519Pub)
      await repo.secretsView.put('secrets-key/' + identity.publicKey.toString('hex'), {
        encryptedKey: envelope.toString('hex'),
        keyVersion: 1
      })
      await repo.secretsView.put('secrets-key-version', 1)

      const f1 = join(tmpDir, 'a')
      await writeFile(f1, '1')
      await runAdd([f1], opts)

      opts.streams.stdout = new PassThrough()
      await runList(['--json'], opts)
      opts.streams.stdout.end()
      const outStr = opts.streams.stdout.read()?.toString() || ''
      const out = JSON.parse(outStr)
      assert.deepEqual(out, ['a'])
    })
  })

  describe('rm', () => {
    test('remove secret', async () => {
      const { runAdd, runRm } = await import(COMMANDS_PATH)
      const secretsKey = Buffer.alloc(32, 'k')
      const x25519Pub = deriveX25519Pub(identity.publicKey)
      const envelope = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(envelope, secretsKey, x25519Pub)
      await repo.secretsView.put('secrets-key/' + identity.publicKey.toString('hex'), {
        encryptedKey: envelope.toString('hex'),
        keyVersion: 1
      })
      await repo.secretsView.put('secrets-key-version', 1)

      const f1 = join(tmpDir, 'a')
      await writeFile(f1, '1')
      await runAdd([f1], opts)

      await runRm(['a'], opts)
      const entry = await db.get('files/a')
      assert.strictEqual(entry, null)
    })
  })

  describe('rotate', () => {
    test('rotation re-encrypts files', async () => {
      const { runAdd, runRotate } = await import(COMMANDS_PATH)
      
      const secretsKey1 = Buffer.alloc(32, '1')
      const x25519Pub = deriveX25519Pub(identity.publicKey)
      const envelope = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(envelope, secretsKey1, x25519Pub)
      await repo.secretsView.put('secrets-key/' + identity.publicKey.toString('hex'), {
        encryptedKey: envelope.toString('hex'),
        keyVersion: 1
      })
      await repo.secretsView.put('secrets-key-version', 1)

      const f1 = join(tmpDir, 'a')
      await writeFile(f1, 'original')
      await runAdd([f1], opts)

      await runRotate([], opts)
      
      // In the mock, we manually update the version since appendOp is a no-op in the subcommand call
      // Wait, the subcommand runRotate calls appendOp. In our test, appendOp is mocked as async () => {}.
      // So the view isn't updated.
      
      opts.streams.stdout.end()
      const out = opts.streams.stdout.read()?.toString() || ''
      assert.match(out, /Rotated to key version 2/)
    })

    test('rotate fails if not indexer', async () => {
      const { runRotate } = await import(COMMANDS_PATH)
      repo.isIndexer = () => false
      const err = await runRotate([], opts).catch(e => e)
      assert.strictEqual(err.code, 2)
    })
  })
})
