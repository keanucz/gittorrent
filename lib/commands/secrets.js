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
  const entryKey = 'secrets-key/' + identity.publicKey.toString('hex')
  const entry = await repo.secretsView.get(entryKey)
  if (!entry) return null
  const encryptedKey = Buffer.isBuffer(entry.value.encryptedKey)
    ? entry.value.encryptedKey
    : Buffer.from(entry.value.encryptedKey, 'hex')
  return identity.openKeyEnvelope(encryptedKey)
}

async function getKeyVersion (repo) {
  const entry = await repo.secretsView.get('secrets-key-version')
  return entry ? entry.value : 0
}

export async function runAdd (args, opts) {
  const { repo, identity, secretsDb, streams } = opts
  const { stdout, stderr } = streams

  const localFile = args.find(a => !a.startsWith('--'))
  const nameIdx = args.indexOf('--name')
  const storePath = nameIdx >= 0 ? args[nameIdx + 1] : basename(localFile)

  if (!validatePath(storePath, stderr)) throw new CliError('invalid path', 2)

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
  await secretsDb.put(storePath, Buffer.concat([versionBuf, nonce, ciphertext]))

  log.info({ storePath, keyVersion }, 'secret added')
  stdout.write(`Added ${storePath} (key version: ${keyVersion})\n`)
}

export async function runGet (args, opts) {
  const { repo, identity, secretsDb, streams } = opts
  const { stdout, stderr } = streams

  const storePath = args.find(a => !a.startsWith('--'))
  const outputIdx = args.indexOf('--output')
  const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : null

  const entry = await secretsDb.get(storePath)
  if (!entry) {
    stderr.write(`pear-git: error: secret not found: ${storePath}\n`)
    throw new CliError('secret not found', 2)
  }

  const fileKeyVersion = entry.value.readUInt32LE(0)
  const nonce = entry.value.slice(4, 28)
  const ciphertext = entry.value.slice(28)

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
  const { repo, identity, secretsDb, streams } = opts
  const { stdout, stderr } = streams
  const json = args.includes('--json')

  const secretsKey = await getSecretsKey(repo, identity)
  if (!secretsKey) {
    stderr.write('pear-git: error: no secrets key available\n')
    throw new CliError('no secrets key', 2)
  }

  const paths = []
  for await (const entry of secretsDb.createReadStream()) {
    paths.push(entry.key)
  }

  if (json) {
    stdout.write(JSON.stringify(paths) + '\n')
  } else {
    for (const p of paths) stdout.write(p + '\n')
  }
}

export async function runRm (args, opts) {
  const { repo, identity, secretsDb, streams } = opts
  const { stdout, stderr } = streams

  const storePath = args.find(a => !a.startsWith('--'))

  const secretsKey = await getSecretsKey(repo, identity)
  if (!secretsKey) {
    stderr.write('pear-git: error: no secrets key available\n')
    throw new CliError('no secrets key', 2)
  }

  const entry = await secretsDb.get(storePath)
  if (!entry) {
    stderr.write(`pear-git: error: secret not found: ${storePath}\n`)
    throw new CliError('secret not found', 2)
  }

  await secretsDb.del(storePath)
  log.info({ storePath }, 'secret removed')
  stdout.write(`Removed ${storePath}\n`)
}

export async function runRotate (args, opts) {
  const { repo, identity, secretsDb, streams } = opts
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

  const entries = []
  for await (const entry of secretsDb.createReadStream()) {
    entries.push(entry)
  }

  for (const entry of entries) {
    const nonce = entry.value.slice(4, 28)
    const ciphertext = entry.value.slice(28)
    const plaintext = decryptFile(nonce, ciphertext, oldKey)
    const { nonce: newNonce, ciphertext: newCt } = encryptFile(plaintext, newKey)
    const versionBuf = Buffer.allocUnsafe(4)
    versionBuf.writeUInt32LE(newKeyVersion, 0)
    await secretsDb.put(entry.key, Buffer.concat([versionBuf, newNonce, newCt]))
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

  log.info({ newKeyVersion, fileCount: entries.length }, 'secrets key rotated')
  stdout.write(`Rotated to key version ${newKeyVersion}. Re-encrypted ${entries.length} files.\n`)
}
