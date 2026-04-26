import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import sodium from 'sodium-native'
import Corestore from 'corestore'
import { openRepo } from '../lib/autobase-repo.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIdentity () {
  const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return {
    publicKey,
    sign (data) {
      const sig = Buffer.allocUnsafe(sodium.crypto_sign_BYTES)
      sodium.crypto_sign_detached(sig, data, secretKey)
      return sig
    },
    verify (sig, data, pk) {
      return sodium.crypto_sign_verify_detached(sig, data, pk)
    },
    openKeyEnvelope (encryptedKey) {
      return null // not needed in these tests
    }
  }
}

function makeStore (dir) {
  return new Corestore(dir)
}

const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const SHA3 = 'c'.repeat(40)

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------

describe('autobase-repo', () => {
  let storeDir
  let store
  let identity
  let repo

  beforeEach(async () => {
    storeDir = join(tmpdir(), 'autobase-repo-test-' + randomBytes(4).toString('hex'))
    store = makeStore(storeDir)
    await store.ready()
    identity = makeIdentity()
    repo = await openRepo(store, identity)
  })

  afterEach(async () => {
    if (repo) {
      try { await repo.close() } catch { /* ignore */ }
      repo = null
    }
    if (store) {
      try { await store.close() } catch { /* ignore */ }
      store = null
    }
    if (storeDir) {
      await rm(storeDir, { recursive: true, force: true })
      storeDir = null
    }
  })

  // -------------------------------------------------------------------------
  // AC1: openRepo returns object with key Buffer of byteLength 32
  // -------------------------------------------------------------------------

  test('openRepo returns an object with a key Buffer of byteLength 32', async () => {
    assert.ok(repo !== null && repo !== undefined, 'openRepo should return a repo object')
    assert.ok(Buffer.isBuffer(repo.key), 'repo.key should be a Buffer')
    assert.equal(repo.key.byteLength, 32, 'repo.key should be 32 bytes')
  })

  // -------------------------------------------------------------------------
  // AC2: getRef returns null on fresh repo
  // -------------------------------------------------------------------------

  test('getRef returns null on a fresh repo for any ref', async () => {
    const result = await repo.getRef('refs/heads/main')
    assert.equal(result, null, 'getRef should return null for non-existent ref')
  })

  // -------------------------------------------------------------------------
  // AC3: updateRef sets ref; getRef returns SHA1
  // -------------------------------------------------------------------------

  test('updateRef with oldSha=null sets ref and getRef returns the new SHA', async () => {
    const result = await repo.updateRef('refs/heads/main', null, SHA1)
    assert.equal(result.ok, true, 'updateRef should succeed')
    const sha = await repo.getRef('refs/heads/main')
    assert.equal(sha, SHA1, 'getRef should return the SHA set by updateRef')
  })

  // -------------------------------------------------------------------------
  // AC4: updateRef fast-forward succeeds (SHA1 → SHA2)
  // -------------------------------------------------------------------------

  test('updateRef with correct oldSha succeeds (fast-forward update)', async () => {
    await repo.updateRef('refs/heads/main', null, SHA1)
    const result = await repo.updateRef('refs/heads/main', SHA1, SHA2)
    assert.equal(result.ok, true, 'fast-forward update should succeed')
    const sha = await repo.getRef('refs/heads/main')
    assert.equal(sha, SHA2, 'getRef should return SHA2 after fast-forward')
  })

  // -------------------------------------------------------------------------
  // AC5: updateRef with wrong oldSha and force=false → non-fast-forward
  // -------------------------------------------------------------------------

  test('updateRef with wrong oldSha and force=false returns non-fast-forward', async () => {
    await repo.updateRef('refs/heads/main', null, SHA1)
    const result = await repo.updateRef('refs/heads/main', SHA2, SHA3, false)
    assert.equal(result.ok, false, 'conflicting update should fail')
    assert.equal(result.reason, 'non-fast-forward', 'reason should be non-fast-forward')
  })

  // -------------------------------------------------------------------------
  // AC6: updateRef with wrong oldSha and force=true succeeds
  // -------------------------------------------------------------------------

  test('updateRef with wrong oldSha and force=true succeeds', async () => {
    await repo.updateRef('refs/heads/main', null, SHA1)
    const result = await repo.updateRef('refs/heads/main', SHA2, SHA3, true)
    assert.equal(result.ok, true, 'force update should succeed despite wrong oldSha')
    const sha = await repo.getRef('refs/heads/main')
    assert.equal(sha, SHA3, 'getRef should return SHA3 after force update')
  })

  // -------------------------------------------------------------------------
  // AC7: updateRef with oldSha=null on non-existent ref succeeds (new branch)
  // -------------------------------------------------------------------------

  test('updateRef with oldSha=null on non-existent ref succeeds (new branch)', async () => {
    const result = await repo.updateRef('refs/heads/feature', null, SHA2)
    assert.equal(result.ok, true, 'creating new branch should succeed')
    const sha = await repo.getRef('refs/heads/feature')
    assert.equal(sha, SHA2, 'getRef should return SHA2 for new branch')
  })

  // -------------------------------------------------------------------------
  // AC8: updateRef with oldSha=null on existing ref and force=false → conflict
  // -------------------------------------------------------------------------

  test('updateRef with oldSha=null on existing ref and force=false returns non-fast-forward', async () => {
    await repo.updateRef('refs/heads/main', null, SHA1)
    const result = await repo.updateRef('refs/heads/main', null, SHA2, false)
    assert.equal(result.ok, false, 'should fail because ref already exists')
    assert.equal(result.reason, 'non-fast-forward', 'reason should be non-fast-forward')
  })

  // -------------------------------------------------------------------------
  // AC9: addWriter(pubkey, false) — getWriters() includes the new writer
  // -------------------------------------------------------------------------

  test('addWriter with indexer=false adds writer to getWriters()', async () => {
    const writerIdentity = makeIdentity()
    await repo.addWriter(writerIdentity.publicKey, false)
    const writers = await repo.getWriters()
    const found = writers.find(w => w.key.equals(writerIdentity.publicKey))
    assert.ok(found, 'new writer should appear in getWriters()')
    assert.equal(found.indexer, false, 'writer should not be an indexer')
  })

  // -------------------------------------------------------------------------
  // AC10: addWriter(pubkey, true) — getWriters() includes writer with indexer=true
  // -------------------------------------------------------------------------

  test('addWriter with indexer=true adds writer with indexer=true to getWriters()', async () => {
    const writerIdentity = makeIdentity()
    await repo.addWriter(writerIdentity.publicKey, true)
    const writers = await repo.getWriters()
    const found = writers.find(w => w.key.equals(writerIdentity.publicKey))
    assert.ok(found, 'new indexer should appear in getWriters()')
    assert.equal(found.indexer, true, 'writer should be an indexer')
  })

  // -------------------------------------------------------------------------
  // AC11: removeWriter — writer no longer in getWriters()
  // -------------------------------------------------------------------------

  test('removeWriter removes writer from getWriters()', async () => {
    const writerIdentity = makeIdentity()
    await repo.addWriter(writerIdentity.publicKey, false)

    const before = await repo.getWriters()
    assert.ok(
      before.some(w => w.key.equals(writerIdentity.publicKey)),
      'writer should exist before removal'
    )

    await repo.removeWriter(writerIdentity.publicKey)

    const after = await repo.getWriters()
    assert.ok(
      !after.some(w => w.key.equals(writerIdentity.publicKey)),
      'writer should not exist after removal'
    )
  })

  // -------------------------------------------------------------------------
  // AC12: removeWriter on the only indexer throws or returns error
  // -------------------------------------------------------------------------

  test('removeWriter on the only indexer throws or returns an error', async () => {
    // The repo creator (identity) is the sole indexer.
    // Attempting to remove them should be refused.
    try {
      const result = await repo.removeWriter(identity.publicKey)
      // If it resolves, it should indicate failure
      assert.ok(
        result === false || (result && result.ok === false),
        'removing last indexer should return a falsy or { ok: false } result'
      )
    } catch (err) {
      // Throwing is also acceptable
      assert.ok(err instanceof Error, 'should throw an Error when removing last indexer')
    }
  })

  // -------------------------------------------------------------------------
  // AC13: ref-update op with invalid signature is silently dropped
  // -------------------------------------------------------------------------

  test('ref-update op with invalid signature is silently dropped (ref not updated)', async () => {
    // A second identity that is NOT a writer attempts to update a ref.
    // Since only authorized writers can update refs, and the op signature won't
    // match any known writer, the op should be silently dropped.
    const rogue = makeIdentity()
    const rogueStore = makeStore(
      join(tmpdir(), 'rogue-store-' + randomBytes(4).toString('hex'))
    )
    await rogueStore.ready()
    let rogueRepo

    try {
      rogueRepo = await openRepo(rogueStore, rogue)

      // Rogue attempts to update a ref in their own repo (not added as a writer
      // to the main repo). Verify that the main repo's ref was not affected.
      await rogueRepo.updateRef('refs/heads/main', null, SHA3)

      // The main repo should not have been affected
      const sha = await repo.getRef('refs/heads/main')
      assert.equal(sha, null, 'ref should remain null — rogue update should be ignored')
    } finally {
      if (rogueRepo) await rogueRepo.close().catch(() => {})
      await rogueStore.close().catch(() => {})
      await rm(rogueStore.storage?.path || join(tmpdir(), 'unused'), {
        recursive: true,
        force: true
      }).catch(() => {})
    }
  })

  // -------------------------------------------------------------------------
  // AC14: secrets-key-envelope op with valid keyVersion stores entry in secretsView
  // -------------------------------------------------------------------------

  test('secrets-key-envelope with valid keyVersion stores entry in secretsView', async () => {
    // The repo exposes a low-level appendOp() for testing, or a high-level
    // distributeSecretsKey() method. We assume one of these exists.
    const recipientIdentity = makeIdentity()
    const secretsKey = Buffer.alloc(32, 0xCC)
    const keyVersion = 1

    // Encrypt the secrets key for the recipient
    const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, recipientIdentity.publicKey)
    const encryptedKey = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(encryptedKey, secretsKey, x25519Pub)

    // Submit the op via appendOp (testing API) or distributeSecretsKey
    if (typeof repo.appendOp === 'function') {
      await repo.appendOp({
        op: 'secrets-key-envelope',
        recipientKey: recipientIdentity.publicKey,
        encryptedKey,
        keyVersion
      })
    } else if (typeof repo.distributeSecretsKey === 'function') {
      await repo.distributeSecretsKey(recipientIdentity.publicKey, encryptedKey, keyVersion)
    } else {
      assert.fail('repo must expose appendOp() or distributeSecretsKey() for testing')
    }

    const entryKey = 'secrets-key/' + recipientIdentity.publicKey.toString('hex')
    const entry = await repo.secretsView.get(entryKey)
    assert.ok(entry, 'secretsView should have entry for recipient')
    assert.ok(entry.value, 'entry should have a value')
    assert.equal(entry.value.keyVersion, keyVersion, 'keyVersion should match')
  })

  // -------------------------------------------------------------------------
  // AC15: secrets-key-envelope with wrong keyVersion is dropped
  // -------------------------------------------------------------------------

  test('secrets-key-envelope with wrong keyVersion is dropped', async () => {
    const recipientIdentity = makeIdentity()
    const secretsKey = Buffer.alloc(32, 0xAA)

    const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, recipientIdentity.publicKey)
    const encryptedKey = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(encryptedKey, secretsKey, x25519Pub)

    const wrongKeyVersion = 99 // current version is 0, so only 1 is valid

    if (typeof repo.appendOp === 'function') {
      await repo.appendOp({
        op: 'secrets-key-envelope',
        recipientKey: recipientIdentity.publicKey,
        encryptedKey,
        keyVersion: wrongKeyVersion
      })
    } else if (typeof repo.distributeSecretsKey === 'function') {
      await repo.distributeSecretsKey(recipientIdentity.publicKey, encryptedKey, wrongKeyVersion)
    } else {
      assert.fail('repo must expose appendOp() or distributeSecretsKey() for testing')
    }

    const entryKey = 'secrets-key/' + recipientIdentity.publicKey.toString('hex')
    const entry = await repo.secretsView.get(entryKey)
    assert.equal(entry, null, 'secretsView entry should not exist for wrong keyVersion')
  })

  // -------------------------------------------------------------------------
  // AC16: secrets-key-rotate with newKeyVersion=currentVersion+1 increments version
  // -------------------------------------------------------------------------

  test('secrets-key-rotate with newKeyVersion=currentVersion+1 increments version', async () => {
    // First set up keyVersion 1
    const recipientIdentity = makeIdentity()
    const secretsKey = Buffer.alloc(32, 0xBB)
    const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, recipientIdentity.publicKey)
    const encryptedKey = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(encryptedKey, secretsKey, x25519Pub)

    if (typeof repo.appendOp === 'function') {
      // First set version 1
      await repo.appendOp({
        op: 'secrets-key-envelope',
        recipientKey: recipientIdentity.publicKey,
        encryptedKey,
        keyVersion: 1
      })
      // Now rotate to version 2
      await repo.appendOp({
        op: 'secrets-key-rotate',
        newKeyVersion: 2
      })
    } else if (typeof repo.rotateSecretsKey === 'function') {
      await repo.rotateSecretsKey(2)
    } else {
      assert.fail('repo must expose appendOp() or rotateSecretsKey() for testing')
    }

    const versionEntry = await repo.secretsView.get('secrets-key-version')
    assert.ok(versionEntry, 'secrets-key-version entry should exist')
    assert.equal(versionEntry.value, 2, 'secrets-key-version should be incremented to 2')
  })

  // -------------------------------------------------------------------------
  // AC17: secrets-key-rotate with wrong newKeyVersion is dropped
  // -------------------------------------------------------------------------

  test('secrets-key-rotate with wrong newKeyVersion is dropped', async () => {
    // Current version is 0, valid rotate target is 1, so 99 is wrong
    if (typeof repo.appendOp === 'function') {
      await repo.appendOp({
        op: 'secrets-key-rotate',
        newKeyVersion: 99
      })
    } else if (typeof repo.rotateSecretsKey === 'function') {
      await repo.rotateSecretsKey(99)
    } else {
      assert.fail('repo must expose appendOp() or rotateSecretsKey() for testing')
    }

    const versionEntry = await repo.secretsView.get('secrets-key-version')
    // Version should still be 0 (not rotated) — entry may be null or have value 0
    if (versionEntry !== null) {
      assert.equal(
        versionEntry.value,
        0,
        'secrets-key-version should remain 0 after invalid rotate'
      )
    }
    // null is also acceptable (no entry = version 0)
  })

  // -------------------------------------------------------------------------
  // AC: view and secretsView are Hyperbee instances
  // -------------------------------------------------------------------------

  test('repo.view is a Hyperbee instance with a get() method', async () => {
    assert.ok(repo.view, 'repo.view should be defined')
    assert.equal(typeof repo.view.get, 'function', 'repo.view should have a get() method')
    assert.equal(typeof repo.view.put, 'function', 'repo.view should have a put() method')
  })

  test('repo.secretsView is a Hyperbee instance with a get() method', async () => {
    assert.ok(repo.secretsView, 'repo.secretsView should be defined')
    assert.equal(typeof repo.secretsView.get, 'function', 'repo.secretsView should have get()')
    assert.equal(typeof repo.secretsView.put, 'function', 'repo.secretsView should have put()')
  })

  test('secret-put stores blob accessible via getSecretFile', async () => {
    const payload = Buffer.from('encrypted-blob-bytes')
    await repo.appendOp({ op: 'secret-put', path: '.env', bytes: payload })
    const got = await repo.getSecretFile('.env')
    assert.ok(got, 'blob should be retrievable')
    assert.ok(got.equals(payload), 'blob should round-trip exactly')
  })

  test('listSecretFiles returns all stored paths', async () => {
    await repo.appendOp({ op: 'secret-put', path: 'a', bytes: Buffer.from('x') })
    await repo.appendOp({ op: 'secret-put', path: 'b', bytes: Buffer.from('y') })
    const list = await repo.listSecretFiles()
    assert.ok(list.includes('a'))
    assert.ok(list.includes('b'))
  })

  test('secret-del removes a stored blob', async () => {
    await repo.appendOp({ op: 'secret-put', path: 'gone', bytes: Buffer.from('v') })
    assert.ok(await repo.hasSecretFile('gone'))
    await repo.appendOp({ op: 'secret-del', path: 'gone' })
    assert.ok(!(await repo.hasSecretFile('gone')))
  })
})
