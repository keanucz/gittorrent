import { test } from 'node:test'
import assert from 'node:assert/strict'
import c from 'compact-encoding'

// This import will throw MODULE_NOT_FOUND until lib/codec.js is implemented.
import {
  refUpdateCodec,
  addWriterCodec,
  removeWriterCodec,
  objectsAvailableCodec,
  secretsKeyEnvelopeCodec,
  secretsKeyRotateCodec,
  opCodec
} from '../lib/codec.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const pubkey = Buffer.alloc(32, 0x01)
const sig = Buffer.alloc(64, 0x02)
const encryptedKey = Buffer.alloc(80, 0x03)

// ---------------------------------------------------------------------------
// refUpdateCodec
// ---------------------------------------------------------------------------

test('refUpdateCodec: round-trips a ref-update op with oldSha present and force=false', () => {
  const value = {
    op: 'ref-update',
    ref: 'refs/heads/main',
    oldSha: SHA,
    newSha: SHA2,
    force: false,
    signature: sig,
    timestamp: 1700000000
  }
  const buf = c.encode(refUpdateCodec, value)
  const decoded = c.decode(refUpdateCodec, buf)

  assert.equal(decoded.op, value.op)
  assert.equal(decoded.ref, value.ref)
  assert.equal(decoded.oldSha, value.oldSha)
  assert.equal(decoded.newSha, value.newSha)
  assert.equal(decoded.force, value.force)
  assert.deepEqual(decoded.signature, value.signature)
  assert.equal(decoded.timestamp, value.timestamp)
})

test('refUpdateCodec: round-trips a ref-update op with oldSha=null', () => {
  const value = {
    op: 'ref-update',
    ref: 'refs/heads/feature',
    oldSha: null,
    newSha: SHA,
    force: false,
    signature: sig,
    timestamp: 1700000001
  }
  const buf = c.encode(refUpdateCodec, value)
  const decoded = c.decode(refUpdateCodec, buf)

  assert.equal(decoded.oldSha, null)
  assert.equal(decoded.newSha, value.newSha)
})

test('refUpdateCodec: round-trips a ref-update op with force=true', () => {
  const value = {
    op: 'ref-update',
    ref: 'refs/heads/main',
    oldSha: SHA,
    newSha: SHA2,
    force: true,
    signature: sig,
    timestamp: 1700000002
  }
  const buf = c.encode(refUpdateCodec, value)
  const decoded = c.decode(refUpdateCodec, buf)

  assert.equal(decoded.force, true)
})

test('refUpdateCodec: preencode state.end matches bytes actually written', () => {
  const value = {
    op: 'ref-update',
    ref: 'refs/heads/main',
    oldSha: SHA,
    newSha: SHA2,
    force: false,
    signature: sig,
    timestamp: 1700000000
  }
  const state = c.state()
  refUpdateCodec.preencode(state, value)
  const predictedLength = state.end

  const buf = c.encode(refUpdateCodec, value)
  assert.equal(predictedLength, buf.byteLength)
})

test('refUpdateCodec: encoding is deterministic', () => {
  const value = {
    op: 'ref-update',
    ref: 'refs/heads/main',
    oldSha: SHA,
    newSha: SHA2,
    force: true,
    signature: sig,
    timestamp: 1700000000
  }
  const buf1 = c.encode(refUpdateCodec, value)
  const buf2 = c.encode(refUpdateCodec, value)
  assert.deepEqual(buf1, buf2)
})

// ---------------------------------------------------------------------------
// addWriterCodec
// ---------------------------------------------------------------------------

test('addWriterCodec: round-trips an add-writer op with indexer=true', () => {
  const value = { op: 'add-writer', key: pubkey, indexer: true, signature: sig }
  const buf = c.encode(addWriterCodec, value)
  const decoded = c.decode(addWriterCodec, buf)

  assert.equal(decoded.op, value.op)
  assert.deepEqual(decoded.key, value.key)
  assert.equal(decoded.indexer, true)
  assert.deepEqual(decoded.signature, value.signature)
})

test('addWriterCodec: round-trips an add-writer op with indexer=false', () => {
  const value = { op: 'add-writer', key: pubkey, indexer: false, signature: sig }
  const buf = c.encode(addWriterCodec, value)
  const decoded = c.decode(addWriterCodec, buf)

  assert.equal(decoded.indexer, false)
})

test('addWriterCodec: preencode state.end matches bytes actually written', () => {
  const value = { op: 'add-writer', key: pubkey, indexer: true, signature: sig }
  const state = c.state()
  addWriterCodec.preencode(state, value)
  const predictedLength = state.end

  const buf = c.encode(addWriterCodec, value)
  assert.equal(predictedLength, buf.byteLength)
})

test('addWriterCodec: encoding is deterministic', () => {
  const value = { op: 'add-writer', key: pubkey, indexer: false, signature: sig }
  const buf1 = c.encode(addWriterCodec, value)
  const buf2 = c.encode(addWriterCodec, value)
  assert.deepEqual(buf1, buf2)
})

// ---------------------------------------------------------------------------
// removeWriterCodec
// ---------------------------------------------------------------------------

test('removeWriterCodec: round-trips a remove-writer op', () => {
  const value = { op: 'remove-writer', key: pubkey, signature: sig }
  const buf = c.encode(removeWriterCodec, value)
  const decoded = c.decode(removeWriterCodec, buf)

  assert.equal(decoded.op, value.op)
  assert.deepEqual(decoded.key, value.key)
  assert.deepEqual(decoded.signature, value.signature)
})

test('removeWriterCodec: preencode state.end matches bytes actually written', () => {
  const value = { op: 'remove-writer', key: pubkey, signature: sig }
  const state = c.state()
  removeWriterCodec.preencode(state, value)
  const predictedLength = state.end

  const buf = c.encode(removeWriterCodec, value)
  assert.equal(predictedLength, buf.byteLength)
})

test('removeWriterCodec: encoding is deterministic', () => {
  const value = { op: 'remove-writer', key: pubkey, signature: sig }
  const buf1 = c.encode(removeWriterCodec, value)
  const buf2 = c.encode(removeWriterCodec, value)
  assert.deepEqual(buf1, buf2)
})

// ---------------------------------------------------------------------------
// objectsAvailableCodec
// ---------------------------------------------------------------------------

test('objectsAvailableCodec: round-trips an objects-available op with an empty shas array', () => {
  const value = { op: 'objects-available', shas: [] }
  const buf = c.encode(objectsAvailableCodec, value)
  const decoded = c.decode(objectsAvailableCodec, buf)

  assert.equal(decoded.op, value.op)
  assert.deepEqual(decoded.shas, [])
})

test('objectsAvailableCodec: round-trips an objects-available op with a single SHA', () => {
  const value = { op: 'objects-available', shas: [SHA] }
  const buf = c.encode(objectsAvailableCodec, value)
  const decoded = c.decode(objectsAvailableCodec, buf)

  assert.deepEqual(decoded.shas, [SHA])
})

test('objectsAvailableCodec: round-trips an objects-available op with 256 SHAs', () => {
  const shas = Array.from({ length: 256 }, (_, i) =>
    String(i % 10).repeat(40)
  )
  const value = { op: 'objects-available', shas }
  const buf = c.encode(objectsAvailableCodec, value)
  const decoded = c.decode(objectsAvailableCodec, buf)

  assert.equal(decoded.shas.length, 256)
  assert.deepEqual(decoded.shas, shas)
})

test('objectsAvailableCodec: preencode state.end matches bytes actually written', () => {
  const value = { op: 'objects-available', shas: [SHA, SHA2] }
  const state = c.state()
  objectsAvailableCodec.preencode(state, value)
  const predictedLength = state.end

  const buf = c.encode(objectsAvailableCodec, value)
  assert.equal(predictedLength, buf.byteLength)
})

test('objectsAvailableCodec: encoding is deterministic', () => {
  const value = { op: 'objects-available', shas: [SHA, SHA2] }
  const buf1 = c.encode(objectsAvailableCodec, value)
  const buf2 = c.encode(objectsAvailableCodec, value)
  assert.deepEqual(buf1, buf2)
})

// ---------------------------------------------------------------------------
// secretsKeyEnvelopeCodec
// ---------------------------------------------------------------------------

test('secretsKeyEnvelopeCodec: round-trips a secrets-key-envelope op with 80-byte encryptedKey', () => {
  const value = {
    op: 'secrets-key-envelope',
    recipientKey: pubkey,
    encryptedKey,
    keyVersion: 1,
    signature: sig
  }
  const buf = c.encode(secretsKeyEnvelopeCodec, value)
  const decoded = c.decode(secretsKeyEnvelopeCodec, buf)

  assert.equal(decoded.op, value.op)
  assert.deepEqual(decoded.recipientKey, value.recipientKey)
  assert.deepEqual(decoded.encryptedKey, value.encryptedKey)
  assert.equal(decoded.keyVersion, value.keyVersion)
  assert.deepEqual(decoded.signature, value.signature)
})

test('secretsKeyEnvelopeCodec: preserves keyVersion as a uint32', () => {
  const value = {
    op: 'secrets-key-envelope',
    recipientKey: pubkey,
    encryptedKey,
    keyVersion: 0xffffffff,
    signature: sig
  }
  const buf = c.encode(secretsKeyEnvelopeCodec, value)
  const decoded = c.decode(secretsKeyEnvelopeCodec, buf)

  assert.equal(decoded.keyVersion, 0xffffffff)
})

test('secretsKeyEnvelopeCodec: preencode state.end matches bytes actually written', () => {
  const value = {
    op: 'secrets-key-envelope',
    recipientKey: pubkey,
    encryptedKey,
    keyVersion: 1,
    signature: sig
  }
  const state = c.state()
  secretsKeyEnvelopeCodec.preencode(state, value)
  const predictedLength = state.end

  const buf = c.encode(secretsKeyEnvelopeCodec, value)
  assert.equal(predictedLength, buf.byteLength)
})

test('secretsKeyEnvelopeCodec: encoding is deterministic', () => {
  const value = {
    op: 'secrets-key-envelope',
    recipientKey: pubkey,
    encryptedKey,
    keyVersion: 7,
    signature: sig
  }
  const buf1 = c.encode(secretsKeyEnvelopeCodec, value)
  const buf2 = c.encode(secretsKeyEnvelopeCodec, value)
  assert.deepEqual(buf1, buf2)
})

// ---------------------------------------------------------------------------
// secretsKeyRotateCodec
// ---------------------------------------------------------------------------

test('secretsKeyRotateCodec: round-trips a secrets-key-rotate op', () => {
  const value = { op: 'secrets-key-rotate', newKeyVersion: 2, signature: sig }
  const buf = c.encode(secretsKeyRotateCodec, value)
  const decoded = c.decode(secretsKeyRotateCodec, buf)

  assert.equal(decoded.op, value.op)
  assert.equal(decoded.newKeyVersion, value.newKeyVersion)
  assert.deepEqual(decoded.signature, value.signature)
})

test('secretsKeyRotateCodec: preserves newKeyVersion as a uint32', () => {
  const value = { op: 'secrets-key-rotate', newKeyVersion: 0xffffffff, signature: sig }
  const buf = c.encode(secretsKeyRotateCodec, value)
  const decoded = c.decode(secretsKeyRotateCodec, buf)

  assert.equal(decoded.newKeyVersion, 0xffffffff)
})

test('secretsKeyRotateCodec: preencode state.end matches bytes actually written', () => {
  const value = { op: 'secrets-key-rotate', newKeyVersion: 3, signature: sig }
  const state = c.state()
  secretsKeyRotateCodec.preencode(state, value)
  const predictedLength = state.end

  const buf = c.encode(secretsKeyRotateCodec, value)
  assert.equal(predictedLength, buf.byteLength)
})

test('secretsKeyRotateCodec: encoding is deterministic', () => {
  const value = { op: 'secrets-key-rotate', newKeyVersion: 5, signature: sig }
  const buf1 = c.encode(secretsKeyRotateCodec, value)
  const buf2 = c.encode(secretsKeyRotateCodec, value)
  assert.deepEqual(buf1, buf2)
})

// ---------------------------------------------------------------------------
// opCodec — discriminated union
// ---------------------------------------------------------------------------

test('opCodec: round-trips a ref-update op preserving the op discriminant', () => {
  const value = {
    op: 'ref-update',
    ref: 'refs/heads/main',
    oldSha: SHA,
    newSha: SHA2,
    force: false,
    signature: sig,
    timestamp: 1700000000
  }
  const buf = c.encode(opCodec, value)
  const decoded = c.decode(opCodec, buf)

  assert.equal(decoded.op, 'ref-update')
  assert.equal(decoded.ref, value.ref)
  assert.equal(decoded.newSha, value.newSha)
})

test('opCodec: round-trips an add-writer op preserving the op discriminant', () => {
  const value = { op: 'add-writer', key: pubkey, indexer: true, signature: sig }
  const buf = c.encode(opCodec, value)
  const decoded = c.decode(opCodec, buf)

  assert.equal(decoded.op, 'add-writer')
  assert.deepEqual(decoded.key, value.key)
  assert.equal(decoded.indexer, value.indexer)
})

test('opCodec: round-trips a remove-writer op preserving the op discriminant', () => {
  const value = { op: 'remove-writer', key: pubkey, signature: sig }
  const buf = c.encode(opCodec, value)
  const decoded = c.decode(opCodec, buf)

  assert.equal(decoded.op, 'remove-writer')
  assert.deepEqual(decoded.key, value.key)
})

test('opCodec: round-trips an objects-available op preserving the op discriminant', () => {
  const value = { op: 'objects-available', shas: [SHA] }
  const buf = c.encode(opCodec, value)
  const decoded = c.decode(opCodec, buf)

  assert.equal(decoded.op, 'objects-available')
  assert.deepEqual(decoded.shas, value.shas)
})

test('opCodec: round-trips a secrets-key-envelope op preserving the op discriminant', () => {
  const value = {
    op: 'secrets-key-envelope',
    recipientKey: pubkey,
    encryptedKey,
    keyVersion: 1,
    signature: sig
  }
  const buf = c.encode(opCodec, value)
  const decoded = c.decode(opCodec, buf)

  assert.equal(decoded.op, 'secrets-key-envelope')
  assert.equal(decoded.keyVersion, value.keyVersion)
})

test('opCodec: round-trips a secrets-key-rotate op preserving the op discriminant', () => {
  const value = { op: 'secrets-key-rotate', newKeyVersion: 2, signature: sig }
  const buf = c.encode(opCodec, value)
  const decoded = c.decode(opCodec, buf)

  assert.equal(decoded.op, 'secrets-key-rotate')
  assert.equal(decoded.newKeyVersion, value.newKeyVersion)
})

test('opCodec: encoding is deterministic for all op types', () => {
  const ops = [
    { op: 'ref-update', ref: 'refs/heads/main', oldSha: SHA, newSha: SHA2, force: false, signature: sig, timestamp: 1700000000 },
    { op: 'add-writer', key: pubkey, indexer: true, signature: sig },
    { op: 'remove-writer', key: pubkey, signature: sig },
    { op: 'objects-available', shas: [SHA] },
    { op: 'secrets-key-envelope', recipientKey: pubkey, encryptedKey, keyVersion: 1, signature: sig },
    { op: 'secrets-key-rotate', newKeyVersion: 2, signature: sig }
  ]
  for (const value of ops) {
    const buf1 = c.encode(opCodec, value)
    const buf2 = c.encode(opCodec, value)
    assert.deepEqual(buf1, buf2, `encoding not deterministic for op="${value.op}"`)
  }
})
