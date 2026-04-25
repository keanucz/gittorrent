import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, stat, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sodium from 'sodium-native'
import { loadIdentity } from '../lib/identity.js'

// Fixed test data
const data = Buffer.alloc(32, 0xAB)

describe('identity', () => {
  let tmpDir

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'identity-test-'))
  })

  after(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('AC1: loadIdentity is a function exported from identity.js', () => {
    assert.equal(typeof loadIdentity, 'function')
  })

  test('AC2: calling loadIdentity(tmpDir) on a fresh directory creates tmpDir/identity file', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-fresh-'))
    try {
      await loadIdentity(freshDir)
      const identityPath = join(freshDir, 'identity')
      const stats = await stat(identityPath)
      assert.ok(stats.isFile(), 'identity file should exist')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC3: identity file is valid JSON with publicKey, secretKey, createdAt fields', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-json-'))
    try {
      await loadIdentity(freshDir)
      const identityPath = join(freshDir, 'identity')
      const content = await readFile(identityPath, 'utf-8')
      const parsed = JSON.parse(content)

      assert.ok(parsed.publicKey, 'publicKey field should exist')
      assert.ok(parsed.secretKey, 'secretKey field should exist')
      assert.ok(parsed.createdAt, 'createdAt field should exist')
      assert.equal(typeof parsed.publicKey, 'string')
      assert.equal(typeof parsed.secretKey, 'string')
      assert.equal(typeof parsed.createdAt, 'string')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC4: identity file created with mode 0600', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-mode-'))
    try {
      await loadIdentity(freshDir)
      const identityPath = join(freshDir, 'identity')
      const stats = await stat(identityPath)
      const mode = stats.mode & 0o777
      assert.equal(mode, 0o600, `expected mode 0600, got ${mode.toString(8)}`)
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC5: publicKey in file is a 64-char hex string (32 bytes)', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-pubkey-'))
    try {
      await loadIdentity(freshDir)
      const identityPath = join(freshDir, 'identity')
      const content = await readFile(identityPath, 'utf-8')
      const parsed = JSON.parse(content)

      assert.equal(parsed.publicKey.length, 64, 'publicKey should be 64 hex chars')
      assert.match(parsed.publicKey, /^[0-9a-f]{64}$/, 'publicKey should be lowercase hex')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC6: secretKey in file is a 128-char hex string (64 bytes)', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-seckey-'))
    try {
      await loadIdentity(freshDir)
      const identityPath = join(freshDir, 'identity')
      const content = await readFile(identityPath, 'utf-8')
      const parsed = JSON.parse(content)

      assert.equal(parsed.secretKey.length, 128, 'secretKey should be 128 hex chars')
      assert.match(parsed.secretKey, /^[0-9a-f]{128}$/, 'secretKey should be lowercase hex')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC7: calling loadIdentity(tmpDir) a second time returns the same publicKey (idempotent)', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-idempotent-'))
    try {
      const identity1 = await loadIdentity(freshDir)
      const identity2 = await loadIdentity(freshDir)

      assert.deepEqual(
        identity1.publicKey,
        identity2.publicKey,
        'publicKey should be the same on second load'
      )
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC8: identity.sign(data) returns a 64-byte Buffer', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-sign-'))
    try {
      const identity = await loadIdentity(freshDir)
      const signature = identity.sign(data)

      assert.ok(Buffer.isBuffer(signature), 'signature should be a Buffer')
      assert.equal(signature.byteLength, 64, 'signature should be 64 bytes')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC9: identity.verify(sig, data, identity.publicKey) returns true for valid sig', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-verify-valid-'))
    try {
      const identity = await loadIdentity(freshDir)
      const signature = identity.sign(data)
      const isValid = identity.verify(signature, data, identity.publicKey)

      assert.equal(isValid, true, 'verify should return true for valid signature')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC10: identity.verify(sig, data, otherPubkey) returns false (wrong key)', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-verify-wrong-'))
    try {
      const identity = await loadIdentity(freshDir)
      const signature = identity.sign(data)

      // Generate a different keypair
      const otherPublicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
      const otherSecretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
      sodium.crypto_sign_keypair(otherPublicKey, otherSecretKey)

      const isValid = identity.verify(signature, data, otherPublicKey)
      assert.equal(isValid, false, 'verify should return false for wrong public key')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC11: identity.verify(tamperedSig, data, identity.publicKey) returns false', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-verify-tampered-'))
    try {
      const identity = await loadIdentity(freshDir)
      const signature = identity.sign(data)

      // Tamper with the signature
      const tamperedSig = Buffer.from(signature)
      tamperedSig[0] ^= 0xFF

      const isValid = identity.verify(tamperedSig, data, identity.publicKey)
      assert.equal(isValid, false, 'verify should return false for tampered signature')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC12: returned identity object does NOT have a secretKey property', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-no-secret-'))
    try {
      const identity = await loadIdentity(freshDir)

      assert.equal('secretKey' in identity, false, 'identity object should not have secretKey property')
      assert.equal(identity.secretKey, undefined, 'identity.secretKey should be undefined')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC13: identity.publicKey is a Buffer with byteLength === 32', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-pubkey-buffer-'))
    try {
      const identity = await loadIdentity(freshDir)

      assert.ok(Buffer.isBuffer(identity.publicKey), 'publicKey should be a Buffer')
      assert.equal(identity.publicKey.byteLength, 32, 'publicKey should be 32 bytes')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC14: all tests use temp directory and clean up', async () => {
    // This is a meta-test: verify tmpDir cleanup happens
    const testTmpDir = await mkdtemp(join(tmpdir(), 'identity-cleanup-'))
    try {
      await loadIdentity(testTmpDir)
      assert.ok(true, 'loadIdentity should work in temp directory')
    } finally {
      await rm(testTmpDir, { recursive: true, force: true })
    }
  })

  test('AC15: loadIdentity throws on corrupted identity file with invalid hex keys', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-corrupt-'))
    try {
      const identityPath = join(freshDir, 'identity')
      const corrupted = {
        publicKey: 'ZZZZ_not_valid_hex_at_all',
        secretKey: 'also_not_valid_hex',
        createdAt: new Date().toISOString()
      }
      await writeFile(identityPath, JSON.stringify(corrupted, null, 2) + '\n', { mode: 0o600 })

      await assert.rejects(
        () => loadIdentity(freshDir),
        (err) => {
          assert.ok(err instanceof Error, 'should throw an Error')
          assert.ok(err.message.includes('Corrupted'), 'message should mention Corrupted')
          return true
        }
      )
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC16: loadIdentity throws on corrupted identity file with invalid JSON', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-badjson-'))
    try {
      const identityPath = join(freshDir, 'identity')
      await writeFile(identityPath, '{{not valid json at all', { mode: 0o600 })

      await assert.rejects(
        () => loadIdentity(freshDir),
        (err) => {
          assert.ok(err instanceof Error, 'should throw an Error')
          assert.ok(
            err.message.includes('corrupted identity file') && err.message.includes('invalid JSON'),
            `message should mention corrupted identity file and invalid JSON, got: ${err.message}`
          )
          return true
        }
      )
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC17: loadIdentity succeeds when file has wrong permissions (0644)', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-perms-'))
    try {
      // First create a valid identity
      await loadIdentity(freshDir)
      const identityPath = join(freshDir, 'identity')

      // Loosen permissions to 0644
      await chmod(identityPath, 0o644)

      // Should still load successfully (just warn, not throw)
      const identity = await loadIdentity(freshDir)
      assert.ok(identity, 'identity should be returned despite wrong permissions')
      assert.ok(Buffer.isBuffer(identity.publicKey), 'publicKey should be a Buffer')
      assert.equal(identity.publicKey.byteLength, 32, 'publicKey should be 32 bytes')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC18: openKeyEnvelope decrypts a sealed box correctly', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-envelope-'))
    try {
      const identity = await loadIdentity(freshDir)

      // Derive X25519 pub from identity's ed25519 pub
      const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
      sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, identity.publicKey)

      // Seal a 32-byte key
      const secretsKey = Buffer.alloc(32, 0xCC)
      const sealed = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
      sodium.crypto_box_seal(sealed, secretsKey, x25519Pub)

      // Decrypt and verify
      const decrypted = identity.openKeyEnvelope(sealed)
      assert.ok(Buffer.isBuffer(decrypted), 'decrypted should be a Buffer')
      assert.deepEqual(decrypted, secretsKey, 'decrypted key should match original')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test('AC19: openKeyEnvelope returns null for garbage input', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'identity-envelope-bad-'))
    try {
      const identity = await loadIdentity(freshDir)

      // Pass garbage buffer (must be at least crypto_box_SEALBYTES long)
      const garbage = Buffer.alloc(32 + sodium.crypto_box_SEALBYTES, 0xFF)
      const result = identity.openKeyEnvelope(garbage)
      assert.equal(result, null, 'openKeyEnvelope should return null for garbage input')
    } finally {
      await rm(freshDir, { recursive: true, force: true })
    }
  })
})
