import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import sodium from 'sodium-native'
import pino from 'pino'
import { encryptFile, decryptFile } from '../secrets.js'
import { CliError } from './cli-error.js'

const rootLogger = pino({
  level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
  redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
  base: { pid: process.pid }
}, pino.destination({ fd: 2 }))

const log = rootLogger.child({ component: 'secrets-commands' })

const PATH_RE = /^[\w.\-/]+$/

function validatePath (p, stderr) {
  if (!PATH_RE.test(p) || p.includes('..') || p.length > 255) {
    stderr.write(`pear-git: error: invalid secret path: ${p}\n`)
    return false
  }
  return true
}

async function getSecretsKey (repo, identity) {
  const pubHex = identity.publicKey.toString('hex')
  // Prefer the RPC-friendly helper when present (RPC proxy path); fall back
  // to the direct bee access on local repo objects.
  let envelope = null
  if (typeof repo.getSecretsKeyEnvelope === 'function') {
    envelope = await repo.getSecretsKeyEnvelope(pubHex)
  } else if (repo.secretsView) {
    const entry = await repo.secretsView.get('secrets-key/' + pubHex)
    envelope = entry ? entry.value : null
  }
  if (!envelope) return null
  const encryptedKey = Buffer.isBuffer(envelope.encryptedKey)
    ? envelope.encryptedKey
    : Buffer.from(envelope.encryptedKey, 'hex')
  return identity.openKeyEnvelope(encryptedKey)
}

async function getKeyVersion (repo) {
  if (typeof repo.getSecretsKeyVersion === 'function') {
    return repo.getSecretsKeyVersion()
  }
  const entry = await repo.secretsView.get('secrets-key-version')
  return entry ? entry.value : 0
}

async function requireIndexer (repo, identity, stderr) {
  const writers = await repo.getWriters()
  const caller = writers.find(w => w.key.equals(identity.publicKey))
  if (!caller || !caller.indexer) {
    stderr.write('pear-git: error: only indexers can manage secrets. ' +
      'Ask an existing indexer to run: pear-git invite <your-pubkey> --indexer\n')
    throw new CliError('not an indexer', 2)
  }
}

export async function runAdd (args, opts) {
  const { repo, identity, streams } = opts
  const { stdout, stderr } = streams

  const localFile = args.find(a => !a.startsWith('--'))
  const nameIdx = args.indexOf('--name')
  const storePath = nameIdx >= 0 ? args[nameIdx + 1] : basename(localFile)

  if (!validatePath(storePath, stderr)) throw new CliError('invalid path', 2)

  await requireIndexer(repo, identity, stderr)

  let keyVersion = await getKeyVersion(repo)
  let secretsKey

  if (keyVersion === 0) {
    secretsKey = Buffer.allocUnsafe(32)
    sodium.randombytes_buf(secretsKey)
    keyVersion = 1

    const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, identity.publicKey)
    const encryptedKey = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(encryptedKey, secretsKey, x25519Pub)

    log.debug({ keyVersion }, 'generated new secrets key, appending envelope for self')
    await repo.appendOp({
      op: 'secrets-key-envelope',
      recipientKey: identity.publicKey,
      encryptedKey,
      keyVersion
    })
  } else {
    secretsKey = await getSecretsKey(repo, identity)
    if (!secretsKey) {
      stderr.write('pear-git: error: no secrets key available\n')
      throw new CliError('no secrets key available', 2)
    }
  }

  const content = await readFile(localFile)
  const { nonce, ciphertext } = encryptFile(content, secretsKey)

  const versionBuf = Buffer.allocUnsafe(4)
  versionBuf.writeUInt32LE(keyVersion, 0)
  const bytes = Buffer.concat([versionBuf, nonce, ciphertext])
  await repo.appendOp({ op: 'secret-put', path: storePath, bytes })

  log.info({ storePath, keyVersion }, 'secret added')
  stdout.write(`Added ${storePath} (key version: ${keyVersion})\n`)
}

export async function runGet (args, opts) {
  const { repo, identity, streams } = opts
  const { stdout, stderr } = streams

  const storePath = args.find(a => !a.startsWith('--'))
  const outputIdx = args.indexOf('--output')
  const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : null

  const bytes = await repo.getSecretFile(storePath)
  if (!bytes) {
    stderr.write(`pear-git: error: secret not found: ${storePath}\n`)
    throw new CliError('secret not found', 2)
  }

  const fileKeyVersion = bytes.readUInt32LE(0)
  const nonce = bytes.slice(4, 28)
  const ciphertext = bytes.slice(28)

  const currentVersion = await getKeyVersion(repo)
  const secretsKey = await getSecretsKey(repo, identity)

  if (!secretsKey) {
    stderr.write('pear-git: error: no secrets key available\n')
    throw new CliError('no secrets key', 2)
  }

  if (fileKeyVersion !== currentVersion) {
    stderr.write('pear-git: error: key version mismatch — rotation in progress, retry shortly\n')
    throw new CliError('key version mismatch', 2)
  }

  const plaintext = decryptFile(nonce, ciphertext, secretsKey)

  if (outputFile) {
    await writeFile(outputFile, plaintext)
  } else {
    stdout.write(plaintext.toString())
  }
}

export async function runList (args, opts) {
  const { repo, identity, streams } = opts
  const { stdout, stderr } = streams
  const json = args.includes('--json')

  const secretsKey = await getSecretsKey(repo, identity)
  if (!secretsKey) {
    stderr.write('pear-git: error: no secrets key available\n')
    throw new CliError('no secrets key', 2)
  }

  const paths = await repo.listSecretFiles()

  if (json) {
    stdout.write(JSON.stringify(paths) + '\n')
  } else {
    for (const p of paths) stdout.write(p + '\n')
  }
}

export async function runRm (args, opts) {
  const { repo, identity, streams } = opts
  const { stdout, stderr } = streams

  const storePath = args.find(a => !a.startsWith('--'))

  const secretsKey = await getSecretsKey(repo, identity)
  if (!secretsKey) {
    stderr.write('pear-git: error: no secrets key available\n')
    throw new CliError('no secrets key', 2)
  }

  await requireIndexer(repo, identity, stderr)

  if (!(await repo.hasSecretFile(storePath))) {
    stderr.write(`pear-git: error: secret not found: ${storePath}\n`)
    throw new CliError('secret not found', 2)
  }

  await repo.appendOp({ op: 'secret-del', path: storePath })
  log.info({ storePath }, 'secret removed')
  stdout.write(`Removed ${storePath}\n`)
}

export async function runRotate (args, opts) {
  const { repo, identity, streams } = opts
  const { stdout, stderr } = streams

  const writers = await repo.getWriters()
  const caller = writers.find(w => w.key.equals(identity.publicKey))
  if (!caller || !caller.indexer) {
    stderr.write('pear-git: error: not an indexer — cannot rotate secrets key\n')
    throw new CliError('not an indexer', 2)
  }

  const currentVersion = await getKeyVersion(repo)
  if (currentVersion === 0) {
    stderr.write('pear-git: error: no secrets key exists yet\n')
    throw new CliError('no secrets key', 2)
  }

  const oldKey = await getSecretsKey(repo, identity)
  if (!oldKey) {
    stderr.write('pear-git: error: no secrets key available\n')
    throw new CliError('no secrets key', 2)
  }

  const newKey = Buffer.allocUnsafe(32)
  sodium.randombytes_buf(newKey)
  const newKeyVersion = currentVersion + 1

  const paths = await repo.listSecretFiles()
  const reEncrypted = []
  for (const path of paths) {
    const bytes = await repo.getSecretFile(path)
    if (!bytes) continue
    const nonce = bytes.slice(4, 28)
    const ciphertext = bytes.slice(28)
    const plaintext = decryptFile(nonce, ciphertext, oldKey)
    const { nonce: newNonce, ciphertext: newCt } = encryptFile(plaintext, newKey)
    const versionBuf = Buffer.allocUnsafe(4)
    versionBuf.writeUInt32LE(newKeyVersion, 0)
    reEncrypted.push({ path, bytes: Buffer.concat([versionBuf, newNonce, newCt]) })
  }

  await repo.appendOp({ op: 'secrets-key-rotate', newKeyVersion })

  for (const writer of writers) {
    const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, writer.key)
    const encryptedKey = Buffer.allocUnsafe(newKey.length + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(encryptedKey, newKey, x25519Pub)
    await repo.appendOp({
      op: 'secrets-key-envelope',
      recipientKey: writer.key,
      encryptedKey,
      keyVersion: newKeyVersion
    })
  }

  for (const { path, bytes } of reEncrypted) {
    await repo.appendOp({ op: 'secret-put', path, bytes })
  }

  log.info({ newKeyVersion, fileCount: reEncrypted.length }, 'secrets key rotated')
  stdout.write(`Rotated to key version ${newKeyVersion}. Re-encrypted ${reEncrypted.length} files.\n`)
}
