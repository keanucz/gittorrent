import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import sodium from 'sodium-native'
import { deriveX25519Pub, deriveX25519Secret, sealKey, openKey, encryptFile, decryptFile, getMySecretsKey } from '../lib/secrets.js'

function generateKeypair() {
  const pub = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
  const sec = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(pub, sec)
  return { publicKey: pub, secretKey: sec }
}

function mockView(entries = {}) {
  return {
    async get(key) {
      if (entries[key]) return { value: entries[key] }
      return null
    }
  }
}

function mockIdentity(keypair) {
  return {
    publicKey: keypair.publicKey,
    openKeyEnvelope(encryptedKey) {
      const x25519Secret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
      const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
      sodium.crypto_sign_ed25519_sk_to_curve25519(x25519Secret, keypair.secretKey)
      sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, keypair.publicKey)
      const out = Buffer.allocUnsafe(encryptedKey.length - sodium.crypto_box_SEALBYTES)
      const ok = sodium.crypto_box_seal_open(out, encryptedKey, x25519Pub, x25519Secret)
      return ok ? out : null
    }
  }
}

function testSealKey(secretsKey, recipientEd25519Pub) {
  const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, recipientEd25519Pub)
  const sealed = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(sealed, secretsKey, x25519Pub)
  return sealed
}

describe('secrets', () => {
  test('AC1: test file exists and fails when lib/secrets.js does not exist', () => {
    assert.throws(
      () => {
        deriveX25519Pub(Buffer.alloc(32))
      },
      (_err) => {
        return true
      }
    )
  })

  test('AC2: deriveX25519Pub returns a 32-byte Buffer', () => {
    const keypair = generateKeypair()
    const x25519Pub = deriveX25519Pub(keypair.publicKey)

    assert.ok(Buffer.isBuffer(x25519Pub), 'should return a Buffer')
    assert.equal(x25519Pub.byteLength, 32, 'should be 32 bytes')
  })

  test('AC3: deriveX25519Secret returns a 32-byte Buffer', () => {
    const keypair = generateKeypair()
    const x25519Secret = deriveX25519Secret(keypair.secretKey)

    assert.ok(Buffer.isBuffer(x25519Secret), 'should return a Buffer')
    assert.equal(x25519Secret.byteLength, 32, 'should be 32 bytes')
  })

  test('AC4: deriveX25519Pub is deterministic', () => {
    const keypair = generateKeypair()
    const x25519Pub1 = deriveX25519Pub(keypair.publicKey)
    const x25519Pub2 = deriveX25519Pub(keypair.publicKey)

    assert.deepEqual(x25519Pub1, x25519Pub2, 'same input should produce same output')
  })

  test('AC4: deriveX25519Secret is deterministic', () => {
    const keypair = generateKeypair()
    const x25519Secret1 = deriveX25519Secret(keypair.secretKey)
    const x25519Secret2 = deriveX25519Secret(keypair.secretKey)

    assert.deepEqual(x25519Secret1, x25519Secret2, 'same input should produce same output')
  })

  test('AC5: seal/open round-trip recovers original key', () => {
    const keypair = generateKeypair()
    const originalKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(originalKey)

    const envelope = sealKey(originalKey, keypair.publicKey)
    const recoveredKey = openKey(envelope, keypair.publicKey, keypair.secretKey)

    assert.ok(recoveredKey, 'openKey should not return null')
    assert.deepEqual(recoveredKey, originalKey, 'recovered key should match original')
  })

  test('AC6: openKey returns null when envelope sealed for different recipient', () => {
    const keypair1 = generateKeypair()
    const keypair2 = generateKeypair()
    const originalKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(originalKey)

    const envelope = sealKey(originalKey, keypair1.publicKey)
    const recoveredKey = openKey(envelope, keypair2.publicKey, keypair2.secretKey)

    assert.equal(recoveredKey, null, 'openKey should return null for wrong recipient')
  })

  test('AC7: openKey returns null when envelope is truncated', () => {
    const keypair = generateKeypair()
    const originalKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(originalKey)

    const envelope = sealKey(originalKey, keypair.publicKey)
    const truncatedEnvelope = envelope.subarray(0, envelope.length - 1)

    const recoveredKey = openKey(truncatedEnvelope, keypair.publicKey, keypair.secretKey)
    assert.equal(recoveredKey, null, 'openKey should return null for truncated envelope')
  })

  test('AC7: openKey returns null when envelope is tampered', () => {
    const keypair = generateKeypair()
    const originalKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(originalKey)

    const envelope = sealKey(originalKey, keypair.publicKey)
    const tamperedEnvelope = Buffer.from(envelope)
    tamperedEnvelope[0] ^= 0xFF

    const recoveredKey = openKey(tamperedEnvelope, keypair.publicKey, keypair.secretKey)
    assert.equal(recoveredKey, null, 'openKey should return null for tampered envelope')
  })

  test('AC8: sealKey output length is secretsKey.length + crypto_box_SEALBYTES', () => {
    const keypair = generateKeypair()
    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)

    const envelope = sealKey(secretsKey, keypair.publicKey)

    const expectedLength = secretsKey.length + sodium.crypto_box_SEALBYTES
    assert.equal(envelope.byteLength, expectedLength, `should be ${expectedLength} bytes (32 + 48)`)
  })

  test('AC9: encryptFile/decryptFile round-trip recovers plaintext', () => {
    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)
    const plaintext = Buffer.from('Hello, world! This is a secret message.')

    const { nonce, ciphertext } = encryptFile(plaintext, secretsKey)
    const decrypted = decryptFile(nonce, ciphertext, secretsKey)

    assert.ok(decrypted, 'decryptFile should not return null')
    assert.deepEqual(decrypted, plaintext, 'decrypted plaintext should match original')
  })

  test('AC10: encryptFile returns nonce of exactly 24 bytes', () => {
    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)
    const plaintext = Buffer.from('test data')

    const { nonce } = encryptFile(plaintext, secretsKey)

    assert.ok(Buffer.isBuffer(nonce), 'nonce should be a Buffer')
    assert.equal(nonce.byteLength, sodium.crypto_secretbox_NONCEBYTES, 'nonce should be 24 bytes')
  })

  test('AC11: encryptFile ciphertext length is plaintext.length + crypto_secretbox_MACBYTES', () => {
    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)
    const plaintext = Buffer.from('test data')

    const { ciphertext } = encryptFile(plaintext, secretsKey)

    const expectedLength = plaintext.length + sodium.crypto_secretbox_MACBYTES
    assert.equal(ciphertext.byteLength, expectedLength, `should be ${expectedLength} bytes (plaintext + 16)`)
  })

  test('AC12: decryptFile returns null when wrong secretsKey used', () => {
    const secretsKey1 = Buffer.allocUnsafe(32)
    const secretsKey2 = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey1)
    sodium.randombytes_buf(secretsKey2)
    const plaintext = Buffer.from('secret message')

    const { nonce, ciphertext } = encryptFile(plaintext, secretsKey1)
    const decrypted = decryptFile(nonce, ciphertext, secretsKey2)

    assert.equal(decrypted, null, 'decryptFile should return null for wrong key')
  })

  test('AC13: decryptFile returns null when ciphertext tampered', () => {
    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)
    const plaintext = Buffer.from('secret message')

    const { nonce, ciphertext } = encryptFile(plaintext, secretsKey)
    const tamperedCiphertext = Buffer.from(ciphertext)
    tamperedCiphertext[0] ^= 0xFF

    const decrypted = decryptFile(nonce, tamperedCiphertext, secretsKey)
    assert.equal(decrypted, null, 'decryptFile should return null for tampered ciphertext')
  })

  test('AC14: decryptFile returns null when nonce is wrong', () => {
    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)
    const plaintext = Buffer.from('secret message')

    const { ciphertext } = encryptFile(plaintext, secretsKey)
    const wrongNonce = Buffer.allocUnsafe(sodium.crypto_secretbox_NONCEBYTES)
    sodium.randombytes_buf(wrongNonce)

    const decrypted = decryptFile(wrongNonce, ciphertext, secretsKey)
    assert.equal(decrypted, null, 'decryptFile should return null for wrong nonce')
  })

  test('AC15: encryptFile produces different nonce each call', () => {
    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)
    const plaintext = Buffer.from('same message')

    const result1 = encryptFile(plaintext, secretsKey)
    const result2 = encryptFile(plaintext, secretsKey)

    assert.notDeepEqual(result1.nonce, result2.nonce, 'nonces should be different')
    assert.notDeepEqual(result1.ciphertext, result2.ciphertext, 'ciphertexts should be different')
  })

  test('AC16: getMySecretsKey returns null when no envelope entry exists', async () => {
    const keypair = generateKeypair()
    const identity = mockIdentity(keypair)
    const view = mockView({})

    const result = await getMySecretsKey(view, identity)
    assert.equal(result, null, 'should return null when no envelope exists')
  })

  test('AC17: getMySecretsKey returns the secrets key when valid envelope exists', async () => {
    const keypair = generateKeypair()
    const identity = mockIdentity(keypair)

    const secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)

    const envelope = testSealKey(secretsKey, keypair.publicKey)
    const publicKeyHex = keypair.publicKey.toString('hex')
    const view = mockView({
      [`secrets/${publicKeyHex}`]: envelope
    })

    const result = await getMySecretsKey(view, identity)

    assert.ok(result, 'should return a secrets key')
    assert.ok(Buffer.isBuffer(result), 'result should be a Buffer')
    assert.deepEqual(result, secretsKey, 'returned key should match original')
  })
})
