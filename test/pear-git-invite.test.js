import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

// Target modules — DO NOT EXIST YET (will fail with MODULE_NOT_FOUND)
import { run as runInvite } from '../lib/commands/invite.js'
import { run as runRevoke } from '../lib/commands/revoke.js'
import { CliError } from '../lib/commands/cli-error.js'

/**
 * Test Design Decision:
 * The `run()` functions throw a custom `CliError` on failures with a `.code` property.
 * The dispatcher in `bin/pear-git` translates `err.code` to `process.exit(code)`.
 * This keeps tests cleaner by avoiding `process.exit` mocking.
 */

// ============================================================================
// Mock Factories
// ============================================================================

function makeRepoMock ({ writers = [], secretsKeyVersion = 0, capturedOps = [] } = {}) {
  return {
    capturedOps,
    async getWriters () {
      return writers
    },
    async addWriter (pubkey, opts) {
      capturedOps.push({ op: 'add-writer', key: pubkey, indexer: !!opts?.indexer })
    },
    async removeWriter (pubkey) {
      capturedOps.push({ op: 'remove-writer', key: pubkey })
    },
    async appendOp (op) {
      capturedOps.push(op)
    },
    secretsView: {
      async get (key) {
        if (key === 'secrets-key-version') {
          return secretsKeyVersion > 0 ? { value: secretsKeyVersion } : null
        }
        return null
      }
    }
  }
}

function makeIdentityMock (pubkeyHex) {
  return {
    publicKey: Buffer.from(pubkeyHex, 'hex'),
    sign: () => Buffer.alloc(64, 1),
    verify: () => true,
    openKeyEnvelope: () => Buffer.alloc(32, 2)
  }
}

function makeStreams () {
  const out = []
  const err = []
  return {
    streams: {
      stdout: {
        write: (s) => {
          out.push(s)
          return true
        }
      },
      stderr: {
        write: (s) => {
          err.push(s)
          return true
        }
      }
    },
    out,
    err
  }
}

// ============================================================================
// Test Suite: pear-git invite
// ============================================================================

describe('pear-git invite', () => {
  const INDEXER_PUBKEY = 'a'.repeat(64)
  const NON_INDEXER_PUBKEY = 'b'.repeat(64)
  const NEW_WRITER_PUBKEY = 'c'.repeat(64)

  test('AC1: import run from ../lib/commands/invite.js fails (MODULE_NOT_FOUND)', () => {
    // This test will fail because the module does not exist yet
    assert.equal(typeof runInvite, 'function', 'runInvite should be a function')
  })

  test('AC2: invite <pubkey> by indexer succeeds, addWriter called with indexer: false', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, out } = makeStreams()

    await runInvite([NEW_WRITER_PUBKEY], {
      repo,
      identity: indexerIdentity,
      streams
    })

    // Verify addWriter was called correctly
    assert.equal(capturedOps.length, 1, 'Should have one operation')
    assert.equal(capturedOps[0].op, 'add-writer', 'Should be add-writer op')
    assert.ok(capturedOps[0].key.equals(Buffer.from(NEW_WRITER_PUBKEY, 'hex')), 'Should add correct key')
    assert.equal(capturedOps[0].indexer, false, 'Should set indexer: false by default')

    // Verify stdout contains success message
    const stdoutText = out.join('')
    assert.match(stdoutText, /Invited/, 'stdout should contain "Invited"')
    assert.match(stdoutText, new RegExp(NEW_WRITER_PUBKEY.substring(0, 8)), 'stdout should contain first 8 chars of pubkey')
    assert.match(stdoutText, /indexer:\s*no/i, 'stdout should indicate indexer: no')
  })

  test('AC3: invite <pubkey> --indexer succeeds, addWriter called with indexer: true', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, out } = makeStreams()

    await runInvite([NEW_WRITER_PUBKEY, '--indexer'], {
      repo,
      identity: indexerIdentity,
      streams
    })

    // Verify addWriter was called with indexer: true
    assert.equal(capturedOps.length, 1, 'Should have one operation')
    assert.equal(capturedOps[0].op, 'add-writer', 'Should be add-writer op')
    assert.equal(capturedOps[0].indexer, true, 'Should set indexer: true')

    // Verify stdout indicates indexer: yes
    const stdoutText = out.join('')
    assert.match(stdoutText, /indexer:\s*yes/i, 'stdout should indicate indexer: yes')
  })

  test('AC4: invite by non-indexer exits 2, stderr mentions not an indexer', async () => {
    const nonIndexerIdentity = makeIdentityMock(NON_INDEXER_PUBKEY)
    const writers = [{ key: nonIndexerIdentity.publicKey, indexer: false }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, err } = makeStreams()

    await assert.rejects(
      () => runInvite([NEW_WRITER_PUBKEY], {
        repo,
        identity: nonIndexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    // Verify error message
    const stderrText = err.join('')
    assert.match(stderrText, /not an indexer/i, 'stderr should mention not an indexer')
    assert.match(stderrText, /cannot invite writers/i, 'stderr should mention cannot invite')

    // Verify addWriter was NOT called
    assert.equal(capturedOps.length, 0, 'addWriter should not be called')
  })

  test('AC5: invite pubkey already a writer exits 2, stderr mentions already writer', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const existingWriterKey = Buffer.from(NEW_WRITER_PUBKEY, 'hex')
    const writers = [
      { key: indexerIdentity.publicKey, indexer: true },
      { key: existingWriterKey, indexer: false }
    ]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, err } = makeStreams()

    await assert.rejects(
      () => runInvite([NEW_WRITER_PUBKEY], {
        repo,
        identity: indexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    // Verify error message
    const stderrText = err.join('')
    assert.match(stderrText, /already.*writer/i, 'stderr should mention already a writer')

    // Verify addWriter was NOT called
    assert.equal(capturedOps.length, 0, 'addWriter should not be called')
  })

  test('AC6: invite with invalid pubkey (not hex) exits 2, stderr mentions invalid public key', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const repo = makeRepoMock({ writers })
    const { streams, err } = makeStreams()

    const INVALID_PUBKEY = 'not-hex-at-all'

    await assert.rejects(
      () => runInvite([INVALID_PUBKEY], {
        repo,
        identity: indexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    const stderrText = err.join('')
    assert.match(stderrText, /invalid public key/i, 'stderr should mention invalid public key')
  })

  test('AC7: invite with short pubkey exits 2', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const repo = makeRepoMock({ writers })
    const { streams, err } = makeStreams()

    const SHORT_PUBKEY = 'aabb'

    await assert.rejects(
      () => runInvite([SHORT_PUBKEY], {
        repo,
        identity: indexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    const stderrText = err.join('')
    assert.match(stderrText, /invalid public key|64.*hex/i, 'stderr should mention validation error')
  })

  test('AC8: when secretsKeyVersion > 0 and inviter has key, secrets-key-envelope op appended', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, secretsKeyVersion: 1, capturedOps })
    const { streams } = makeStreams()

    // Mock getMySecretsKey to return a valid key
    const mockSecretsKey = Buffer.alloc(32, 0xaa)
    const getMySecretsKey = async () => mockSecretsKey

    // Mock sealKey so we don't perform real curve25519 sealing on a fabricated
    // (non-valid-point) pubkey fixture. AC8's contract is about *what* op gets
    // emitted and its fields, not the envelope's cryptographic contents.
    const sealKey = () => Buffer.alloc(80, 0x77)

    await runInvite([NEW_WRITER_PUBKEY], {
      repo,
      identity: indexerIdentity,
      streams,
      getMySecretsKey,
      sealKey
    })

    // Verify both add-writer and secrets-key-envelope ops were captured
    assert.equal(capturedOps.length, 2, 'Should have two operations')

    const addWriterOp = capturedOps.find(op => op.op === 'add-writer')
    assert.ok(addWriterOp, 'Should have add-writer op')

    const envelopeOp = capturedOps.find(op => op.op === 'secrets-key-envelope')
    assert.ok(envelopeOp, 'Should have secrets-key-envelope op')
    assert.ok(envelopeOp.recipientKey.equals(Buffer.from(NEW_WRITER_PUBKEY, 'hex')), 'Envelope should be for new writer')
    assert.equal(envelopeOp.keyVersion, 1, 'Envelope should have keyVersion 1')
  })

  test('AC9: when secretsKeyVersion > 0 but inviter lacks key, warning printed, command exits 0', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, secretsKeyVersion: 1, capturedOps })
    const { streams, err } = makeStreams()

    // Mock getMySecretsKey to return null (no key)
    const getMySecretsKey = async () => null

    await runInvite([NEW_WRITER_PUBKEY], {
      repo,
      identity: indexerIdentity,
      streams,
      getMySecretsKey
    })

    // Verify warning was printed
    const stderrText = err.join('')
    assert.match(stderrText, /could not distribute secrets key/i, 'stderr should warn about key distribution failure')

    // Verify add-writer was still called
    const addWriterOp = capturedOps.find(op => op.op === 'add-writer')
    assert.ok(addWriterOp, 'add-writer should still be called')

    // Verify no envelope op
    const envelopeOp = capturedOps.find(op => op.op === 'secrets-key-envelope')
    assert.ok(!envelopeOp, 'secrets-key-envelope should NOT be called')
  })

  test('AC10: when secretsKeyVersion === 0, no envelope op emitted', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, secretsKeyVersion: 0, capturedOps })
    const { streams } = makeStreams()

    // Mock getMySecretsKey to return a valid key (but should not be used)
    const mockSecretsKey = Buffer.alloc(32, 0xaa)
    const getMySecretsKey = async () => mockSecretsKey

    await runInvite([NEW_WRITER_PUBKEY], {
      repo,
      identity: indexerIdentity,
      streams,
      getMySecretsKey
    })

    // Verify only add-writer op exists
    assert.equal(capturedOps.length, 1, 'Should have only one operation')
    const addWriterOp = capturedOps.find(op => op.op === 'add-writer')
    assert.ok(addWriterOp, 'Should have add-writer op')

    const envelopeOp = capturedOps.find(op => op.op === 'secrets-key-envelope')
    assert.ok(!envelopeOp, 'secrets-key-envelope should NOT be emitted when version is 0')
  })
})

// ============================================================================
// Test Suite: pear-git revoke
// ============================================================================

describe('pear-git revoke', () => {
  const INDEXER_PUBKEY = 'a'.repeat(64)
  const NON_INDEXER_PUBKEY = 'b'.repeat(64)
  const TARGET_WRITER_PUBKEY = 'c'.repeat(64)

  test('AC1: import run from ../lib/commands/revoke.js fails (MODULE_NOT_FOUND)', () => {
    // This test will fail because the module does not exist yet
    assert.equal(typeof runRevoke, 'function', 'runRevoke should be a function')
  })

  test('AC2: revoke <pubkey> by indexer succeeds, removeWriter called, stdout shows revoked message', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const targetWriterKey = Buffer.from(TARGET_WRITER_PUBKEY, 'hex')
    const writers = [
      { key: indexerIdentity.publicKey, indexer: true },
      { key: targetWriterKey, indexer: false }
    ]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, out } = makeStreams()

    await runRevoke([TARGET_WRITER_PUBKEY], {
      repo,
      identity: indexerIdentity,
      streams
    })

    // Verify removeWriter was called
    assert.equal(capturedOps.length, 1, 'Should have one operation')
    assert.equal(capturedOps[0].op, 'remove-writer', 'Should be remove-writer op')
    assert.ok(capturedOps[0].key.equals(targetWriterKey), 'Should remove correct key')

    // Verify stdout contains success message
    const stdoutText = out.join('')
    assert.match(stdoutText, /Revoked/i, 'stdout should contain "Revoked"')
    assert.match(stdoutText, new RegExp(TARGET_WRITER_PUBKEY.substring(0, 8)), 'stdout should contain first 8 chars of pubkey')
  })

  test('AC3: revoke always prints exact rotation warning to stderr', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const targetWriterKey = Buffer.from(TARGET_WRITER_PUBKEY, 'hex')
    const writers = [
      { key: indexerIdentity.publicKey, indexer: true },
      { key: targetWriterKey, indexer: false }
    ]
    const repo = makeRepoMock({ writers })
    const { streams, err } = makeStreams()

    await runRevoke([TARGET_WRITER_PUBKEY], {
      repo,
      identity: indexerIdentity,
      streams
    })

    // Verify exact warning text
    const stderrText = err.join('')
    assert.match(
      stderrText,
      /warning: revoked writer retains read access to secrets encrypted before key rotation\./i,
      'stderr should contain first line of warning'
    )
    assert.match(
      stderrText,
      /Run 'pear-git secrets rotate' to revoke their access\./i,
      'stderr should contain second line of warning'
    )
  })

  test('AC4: revoke prints warning even when secretsKeyVersion === 0', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const targetWriterKey = Buffer.from(TARGET_WRITER_PUBKEY, 'hex')
    const writers = [
      { key: indexerIdentity.publicKey, indexer: true },
      { key: targetWriterKey, indexer: false }
    ]
    const repo = makeRepoMock({ writers, secretsKeyVersion: 0 })
    const { streams, err } = makeStreams()

    await runRevoke([TARGET_WRITER_PUBKEY], {
      repo,
      identity: indexerIdentity,
      streams
    })

    // Warning should still be printed
    const stderrText = err.join('')
    assert.match(stderrText, /warning:.*revoked writer retains/i, 'warning should be printed even with no secrets')
  })

  test('AC5: revoke by non-indexer exits 2', async () => {
    const nonIndexerIdentity = makeIdentityMock(NON_INDEXER_PUBKEY)
    const targetWriterKey = Buffer.from(TARGET_WRITER_PUBKEY, 'hex')
    const writers = [
      { key: nonIndexerIdentity.publicKey, indexer: false },
      { key: targetWriterKey, indexer: false }
    ]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, err } = makeStreams()

    await assert.rejects(
      () => runRevoke([TARGET_WRITER_PUBKEY], {
        repo,
        identity: nonIndexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    const stderrText = err.join('')
    assert.match(stderrText, /not an indexer/i, 'stderr should mention not an indexer')

    // Verify removeWriter was NOT called
    assert.equal(capturedOps.length, 0, 'removeWriter should not be called')
  })

  test('AC6: revoke of non-writer exits 2, stderr mentions not a writer', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, err } = makeStreams()

    const NON_WRITER_PUBKEY = 'f'.repeat(64)

    await assert.rejects(
      () => runRevoke([NON_WRITER_PUBKEY], {
        repo,
        identity: indexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    const stderrText = err.join('')
    assert.match(stderrText, /not.*writer/i, 'stderr should mention target is not a writer')

    // Verify removeWriter was NOT called
    assert.equal(capturedOps.length, 0, 'removeWriter should not be called')
  })

  test('AC7: revoke of last indexer exits 2, stderr mentions last indexer', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const capturedOps = []
    const repo = makeRepoMock({ writers, capturedOps })
    const { streams, err } = makeStreams()

    await assert.rejects(
      () => runRevoke([INDEXER_PUBKEY], {
        repo,
        identity: indexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    const stderrText = err.join('')
    assert.match(stderrText, /last indexer/i, 'stderr should mention last indexer')

    // Verify removeWriter was NOT called
    assert.equal(capturedOps.length, 0, 'removeWriter should not be called')
  })

  test('AC8: revoke with invalid hex pubkey exits 2', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const repo = makeRepoMock({ writers })
    const { streams, err } = makeStreams()

    const INVALID_PUBKEY = 'not-hex-at-all'

    await assert.rejects(
      () => runRevoke([INVALID_PUBKEY], {
        repo,
        identity: indexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    const stderrText = err.join('')
    assert.match(stderrText, /invalid public key/i, 'stderr should mention invalid public key')
  })

  test('AC9: revoke with short pubkey exits 2', async () => {
    const indexerIdentity = makeIdentityMock(INDEXER_PUBKEY)
    const writers = [{ key: indexerIdentity.publicKey, indexer: true }]
    const repo = makeRepoMock({ writers })
    const { streams, err } = makeStreams()

    const SHORT_PUBKEY = 'aabb'

    await assert.rejects(
      () => runRevoke([SHORT_PUBKEY], {
        repo,
        identity: indexerIdentity,
        streams
      }),
      (error) => {
        assert.ok(error instanceof CliError, 'Should throw CliError')
        assert.equal(error.code, 2, 'Should exit with code 2')
        return true
      }
    )

    const stderrText = err.join('')
    assert.match(stderrText, /invalid public key|64.*hex/i, 'stderr should mention validation error')
  })
})
