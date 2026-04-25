import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { createObjectStore } from '../lib/object-store.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const INVALID_SHA = 'not-a-sha'
const INVALID_SHA_SHORT = 'abcd'
const INVALID_SHA_UPPERCASE = 'A'.repeat(40)

// Canonical git object: "blob 11\0hello world"
const content = Buffer.from('hello world')
const header = Buffer.from(`blob ${content.length}\0`)
const objectBytes = Buffer.concat([header, content])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function createTestDb () {
  const dir = mkdtempSync(join(tmpdir(), 'gittorrent-test-'))
  const core = new Hypercore(dir)
  const db = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
  
  // Attach the directory to the db object so we can clean it up later
  db._testDir = dir
  return db
}

function cleanupDb (db) {
  if (db && db.core) {
    db.core.close()
  }
  if (db && db._testDir) {
    try {
      rmSync(db._testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('object-store', () => {
  let db
  let store

  beforeEach(() => {
    db = createTestDb()
    store = createObjectStore(db)
  })

  afterEach(async () => {
    await db.close()
    cleanupDb(db)
  })

  // ---- cache miss / empty store ------------------------------------------

  test('has(sha) returns false for a SHA that has not been put', async () => {
    const result = await store.has(SHA1)
    assert.equal(result, false)
  })

  test('get(sha) returns null for a SHA that was never put', async () => {
    const result = await store.get(SHA1)
    assert.equal(result, null)
  })

  // ---- put / has round-trip -----------------------------------------------

  test('put(sha, bytes) followed by has(sha) returns true', async () => {
    await store.put(SHA1, objectBytes)
    const result = await store.has(SHA1)
    assert.equal(result, true)
  })

  // ---- put / get gzip round-trip ------------------------------------------

  test('put(sha, bytes) followed by get(sha) returns a Buffer deep-equal to the original bytes', async () => {
    await store.put(SHA1, objectBytes)
    const result = await store.get(SHA1)
    assert.ok(Buffer.isBuffer(result), 'expected result to be a Buffer')
    assert.deepEqual(result, objectBytes)
  })

  // ---- SHA validation: put ------------------------------------------------

  test('put with an invalid SHA (not 40-char hex) rejects with a descriptive error', async () => {
    await assert.rejects(
      () => store.put(INVALID_SHA, objectBytes),
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.length > 0, 'error should have a descriptive message')
        return true
      }
    )
  })

  // ---- SHA validation: has ------------------------------------------------

  test('has with an invalid SHA rejects', async () => {
    await assert.rejects(
      () => store.has(INVALID_SHA),
      (err) => {
        assert.ok(err instanceof Error)
        return true
      }
    )
  })

  // ---- SHA validation: get ------------------------------------------------

  test('get with an invalid SHA rejects', async () => {
    await assert.rejects(
      () => store.get(INVALID_SHA),
      (err) => {
        assert.ok(err instanceof Error)
        return true
      }
    )
  })

  // ---- SHA validation edge cases ------------------------------------------

  test('put with a too-short SHA rejects', async () => {
    await assert.rejects(() => store.put(INVALID_SHA_SHORT, objectBytes))
  })

  test('put with an uppercase 40-char SHA rejects', async () => {
    await assert.rejects(() => store.put(INVALID_SHA_UPPERCASE, objectBytes))
  })

  // ---- large object round-trip --------------------------------------------

  test('storing and retrieving a large object (100 KB random bytes) round-trips correctly', async () => {
    const largeContent = randomBytes(100 * 1024)
    const largeHeader = Buffer.from(`blob ${largeContent.length}\0`)
    const largeObjectBytes = Buffer.concat([largeHeader, largeContent])

    const sha = 'c'.repeat(40)

    await store.put(sha, largeObjectBytes)
    const result = await store.get(sha)
    assert.ok(Buffer.isBuffer(result), 'expected result to be a Buffer')
    assert.deepEqual(result, largeObjectBytes)
  })

  // ---- two different objects, different SHAs ------------------------------

  test('storing two different objects with different SHAs returns each independently', async () => {
    const content2 = Buffer.from('goodbye world')
    const header2 = Buffer.from(`blob ${content2.length}\0`)
    const objectBytes2 = Buffer.concat([header2, content2])

    await store.put(SHA1, objectBytes)
    await store.put(SHA2, objectBytes2)

    const result1 = await store.get(SHA1)
    const result2 = await store.get(SHA2)

    assert.deepEqual(result1, objectBytes)
    assert.deepEqual(result2, objectBytes2)

    // They should be different from each other
    assert.notDeepEqual(result1, result2)
  })

  // ---- gzip compression verification -------------------------------------

  test('values stored in Hyperbee are gzip-compressed (raw entry differs from original bytes)', async () => {
    await store.put(SHA1, objectBytes)

    // Read the raw entry directly from the Hyperbee
    const entry = await db.get(SHA1)
    assert.ok(entry, 'entry should exist in Hyperbee')

    const rawValue = entry.value

    // The raw stored value must NOT be equal to the original bytes
    // because the object store should gzip-compress before storing.
    assert.notDeepEqual(
      rawValue,
      objectBytes,
      'stored value should be gzip-compressed and therefore differ from original bytes'
    )

    // Additionally verify the raw value starts with a gzip magic number (0x1f 0x8b)
    assert.equal(rawValue[0], 0x1f, 'first byte should be gzip magic byte 0x1f')
    assert.equal(rawValue[1], 0x8b, 'second byte should be gzip magic byte 0x8b')
  })
})
