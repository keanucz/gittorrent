import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import c from 'compact-encoding'
import pino from 'pino'
import bs58 from 'bs58'
import { opCodec } from './codec.js'

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
    redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
    base: { pid: process.pid }
  },
  pino.destination({ fd: 2 })
)

const log = rootLogger.child({ component: 'autobase-repo' })

// ---------------------------------------------------------------------------
// Signable bytes: JSON encoding of the fields relevant for verification
// (excludes the signature itself)
// ---------------------------------------------------------------------------

function signableBytes (op) {
  const fields = { op: op.op }
  if (op.ref !== undefined) fields.ref = op.ref
  if (op.oldSha !== undefined) fields.oldSha = op.oldSha
  if (op.newSha !== undefined) fields.newSha = op.newSha
  if (op.force !== undefined) fields.force = op.force
  if (op.key !== undefined) fields.key = op.key.toString('hex')
  if (op.indexer !== undefined) fields.indexer = op.indexer
  if (op.recipientKey !== undefined) fields.recipientKey = op.recipientKey.toString('hex')
  if (op.encryptedKey !== undefined) fields.encryptedKey = op.encryptedKey.toString('hex')
  if (op.keyVersion !== undefined) fields.keyVersion = op.keyVersion
  if (op.newKeyVersion !== undefined) fields.newKeyVersion = op.newKeyVersion
  if (op.sha !== undefined) fields.sha = op.sha
  if (op.bytes !== undefined) fields.bytes = Buffer.isBuffer(op.bytes) ? op.bytes.toString('hex') : op.bytes
  return Buffer.from(JSON.stringify(fields))
}

// ---------------------------------------------------------------------------
// Check if a writer is an indexer in the current system state
// ---------------------------------------------------------------------------

function isIndexerKey (host, pubkey) {
  return host.system.indexers.some(idx => idx.key.equals(pubkey))
}

// ---------------------------------------------------------------------------
// apply() — deterministic state machine for all op types
// ---------------------------------------------------------------------------

async function apply (nodes, view, host) {
  const secretsView = view.sub('secrets', { valueEncoding: 'json' })
  const writersView = view.sub('writers', { valueEncoding: 'json' })
  const objectsView = view.sub('objects', { valueEncoding: 'binary' })

  for (const node of nodes) {
    const writerKey = node.from.key
    let op
    try {
      op = c.decode(opCodec, node.value)
    } catch (err) {
      log.warn({ err: err.message }, 'failed to decode op, skipping')
      continue
    }

    log.debug({ op: op.op, writerKey: writerKey.toString('hex') }, 'apply op')

    switch (op.op) {
      case 'ref-update':
        await applyRefUpdate(op, writerKey, view)
        break
      case 'add-writer':
        await applyAddWriter(op, writerKey, host, writersView)
        break
      case 'remove-writer':
        await applyRemoveWriter(op, writerKey, host, writersView)
        break
      case 'objects-available':
        // no-op
        break
      case 'secrets-key-envelope':
        await applySecretsKeyEnvelope(op, writerKey, host, secretsView)
        break
      case 'secrets-key-rotate':
        await applySecretsKeyRotate(op, writerKey, host, secretsView)
        break
      case 'object-put':
        await applyObjectPut(op, writerKey, objectsView)
        break
      default:
        log.warn({ op: op.op }, 'unknown op type, skipping')
    }
  }
}

async function applyObjectPut (op, writerKey, objectsView) {
  // Writers upload git objects via an Autobase op so all peers converge on
  // the same object set. Verification of the signature happens at read time
  // — apply() must remain deterministic and side-effect-free w.r.t. network.
  await objectsView.put(op.sha, op.bytes)
}

async function applyRefUpdate (op, writerKey, view) {
  // Check fast-forward constraint
  const current = await view.get(op.ref)
  const currentSha = current ? current.value : null

  if (!op.force && currentSha !== op.oldSha) {
    log.warn({ ref: op.ref, currentSha, oldSha: op.oldSha }, 'ref-update: non-fast-forward, dropping')
    return
  }

  await view.put(op.ref, op.newSha)
  log.info({ ref: op.ref, newSha: op.newSha }, 'ref updated')
}

async function applyAddWriter (op, writerKey, host, writersView) {
  if (!isIndexerKey(host, writerKey)) {
    log.warn({ writerKey: writerKey.toString('hex') }, 'add-writer: sender is not an indexer, dropping')
    return
  }

  await host.addWriter(op.key, { indexer: op.indexer })
  await writersView.put(op.key.toString('hex'), { indexer: op.indexer })
  log.info({ key: op.key.toString('hex'), indexer: op.indexer }, 'writer added')
}

async function applyRemoveWriter (op, writerKey, host, writersView) {
  if (!isIndexerKey(host, writerKey)) {
    log.warn({ writerKey: writerKey.toString('hex') }, 'remove-writer: sender is not an indexer, dropping')
    return
  }

  if (!host.removeable(op.key)) {
    log.warn({ key: op.key.toString('hex') }, 'remove-writer: cannot remove last indexer, dropping')
    return
  }

  await host.removeWriter(op.key)
  await writersView.del(op.key.toString('hex'))
  log.info({ key: op.key.toString('hex') }, 'writer removed')
}

async function applySecretsKeyEnvelope (op, writerKey, host, secretsView) {
  if (!isIndexerKey(host, writerKey)) {
    log.warn({ writerKey: writerKey.toString('hex') }, 'secrets-key-envelope: sender is not an indexer, dropping')
    return
  }

  const versionEntry = await secretsView.get('secrets-key-version')
  const currentVersion = versionEntry ? versionEntry.value : 0

  // Accept envelope if:
  //   - op.keyVersion === currentVersion      (normal case — envelope to a new
  //                                             writer at the existing version)
  //   - op.keyVersion === currentVersion + 1  (bootstrap / in-flight rotation —
  //                                             new version is being introduced)
  // Any other keyVersion is dropped.
  const isEqualVersion = op.keyVersion === currentVersion
  const isNextVersion = op.keyVersion === currentVersion + 1
  if (!isEqualVersion && !isNextVersion) {
    log.warn(
      { keyVersion: op.keyVersion, currentVersion },
      'secrets-key-envelope: keyVersion must equal currentVersion or currentVersion+1, dropping'
    )
    return
  }

  await secretsView.put('secrets-key/' + op.recipientKey.toString('hex'), {
    encryptedKey: op.encryptedKey.toString('hex'),
    keyVersion: op.keyVersion
  })
  // Only bump the tracked version when this envelope introduces a newer version.
  // Equal-version envelopes distribute the existing key to a new recipient and
  // must not advance the version counter.
  if (isNextVersion) {
    await secretsView.put('secrets-key-version', op.keyVersion)
  }
  log.info({ keyVersion: op.keyVersion, recipient: op.recipientKey.toString('hex') }, 'secrets-key-envelope stored')
}

async function applySecretsKeyRotate (op, writerKey, host, secretsView) {
  if (!isIndexerKey(host, writerKey)) {
    log.warn({ writerKey: writerKey.toString('hex') }, 'secrets-key-rotate: sender is not an indexer, dropping')
    return
  }

  const versionEntry = await secretsView.get('secrets-key-version')
  const currentVersion = versionEntry ? versionEntry.value : 0

  if (op.newKeyVersion !== currentVersion + 1) {
    log.warn({ newKeyVersion: op.newKeyVersion, currentVersion }, 'secrets-key-rotate: wrong newKeyVersion, dropping')
    return
  }

  await secretsView.put('secrets-key-version', op.newKeyVersion)
  log.info({ newKeyVersion: op.newKeyVersion }, 'secrets-key rotated')
}

// ---------------------------------------------------------------------------
// openRepo — public API
// ---------------------------------------------------------------------------

export async function openRepo (corestore, identity, opts = {}) {
  const handlers = {
    apply,
    open (store) {
      const core = store.get('view-refs')
      return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8', extension: false, _view: true })
    },
    valueEncoding: 'binary'
  }

  if (identity.keyPair) {
    handlers.keyPair = identity.keyPair
  }

  const base = new Autobase(corestore, opts.key || null, handlers)

  await base.ready()

  const secretsView = base.view.sub('secrets', { valueEncoding: 'json' })
  const writersView = base.view.sub('writers', { valueEncoding: 'json' })
  const objectsView = base.view.sub('objects', { valueEncoding: 'binary' })

  await base.update()

  log.info({ repoKey: bs58.encode(base.key) }, 'repo opened')

  return {
    key: base.key,
    view: base.view,
    secretsView,
    objectsView,

    async update () {
      await base.update()
    },

    async getRef (ref) {
      await base.update()
      const entry = await base.view.get(ref)
      return entry ? entry.value : null
    },

    async updateRef (ref, oldSha, newSha, force = false) {
      const op = {
        op: 'ref-update',
        ref,
        oldSha,
        newSha,
        force,
        signature: Buffer.alloc(64),
        timestamp: Math.floor(Date.now() / 1000)
      }
      op.signature = identity.sign(signableBytes(op))

      await base.append(c.encode(opCodec, op))
      await base.update()

      const current = await base.view.get(ref)
      if (current && current.value === newSha) return { ok: true }
      return { ok: false, reason: 'non-fast-forward' }
    },

    async addWriter (pubkey, indexer) {
      const op = {
        op: 'add-writer',
        key: pubkey,
        indexer,
        signature: Buffer.alloc(64)
      }
      op.signature = identity.sign(signableBytes(op))

      await base.append(c.encode(opCodec, op))
      await base.update()
    },

    async removeWriter (pubkey) {
      const op = {
        op: 'remove-writer',
        key: pubkey,
        signature: Buffer.alloc(64)
      }
      op.signature = identity.sign(signableBytes(op))

      await base.append(c.encode(opCodec, op))
      await base.update()
    },

    async getWriters () {
      await base.update()
      const writers = []
      for await (const entry of writersView.createReadStream()) {
        writers.push({
          key: Buffer.from(entry.key, 'hex'),
          indexer: entry.value.indexer
        })
      }
      return writers
    },

    async putObject (sha, bytes) {
      const op = {
        op: 'object-put',
        sha,
        bytes,
        signature: Buffer.alloc(64)
      }
      op.signature = identity.sign(signableBytes(op))
      await base.append(c.encode(opCodec, op))
    },

    async getObject (sha) {
      await base.update()
      const entry = await objectsView.get(sha)
      return entry ? entry.value : null
    },

    async hasObject (sha) {
      await base.update()
      const entry = await objectsView.get(sha)
      return !!entry
    },

    async appendOp (op) {
      // Sign the op fields (excluding signature)
      const signable = signableBytes(op)
      const signature = identity.sign(signable)

      const fullOp = Object.assign({}, op, { signature })

      // Some ops need Buffer fields restored from strings (if passed as plain objects)
      if (fullOp.key && !Buffer.isBuffer(fullOp.key)) {
        fullOp.key = Buffer.from(fullOp.key, 'hex')
      }
      if (fullOp.recipientKey && !Buffer.isBuffer(fullOp.recipientKey)) {
        fullOp.recipientKey = Buffer.from(fullOp.recipientKey, 'hex')
      }
      if (fullOp.encryptedKey && !Buffer.isBuffer(fullOp.encryptedKey)) {
        fullOp.encryptedKey = Buffer.from(fullOp.encryptedKey, 'hex')
      }

      if (fullOp.op === 'ref-update' && !fullOp.timestamp) {
        fullOp.timestamp = Math.floor(Date.now() / 1000)
      }

      await base.append(c.encode(opCodec, fullOp))
      await base.update()
    },

    async close () {
      await base.close()
    }
  }
}
