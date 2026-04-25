import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import Hyperbee from 'hyperbee'
import sodium from 'sodium-native'
import {
  getMySecretsKey,
  encryptFile,
  decryptFile,
  sealKey
} from '../secrets.js'
import { CliError } from './cli-error.js'

const PATH_RE = /^[\w.\-\/]+$/

function validateSecretPath (p) {
  if (!PATH_RE.test(p) || p.includes('..') || p.length > 255) {
    throw new CliError(`invalid secret path: ${p}`, 2)
  }
}

async function getSecretsDb (corestore) {
  const core = corestore.get({ name: 'secrets' })
  const db = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
  await db.ready()
  return db
}

export async function run (args, opts) {
  const sub = args[0]
  const subArgs = args.slice(1)
  switch (sub) {
    case 'add': return runAdd(subArgs, opts)
    case 'get': return runGet(subArgs, opts)
    case 'list': return runList(subArgs, opts)
    case 'rm': return runRm(subArgs, opts)
    case 'rotate': return runRotate(subArgs, opts)
    default:
      throw new CliError(`unknown secrets subcommand: ${sub}`, 1)
  }
}

export async function runAdd (args, opts) {
  const { repo, identity, corestore, streams } = opts
  const out = streams?.stdout || process.stdout
  
  if (!repo.isWriter(identity.publicKey)) {
    throw new CliError('not a writer', 2)
  }

  const filePath = args[0]
  if (!filePath) throw new CliError('usage: pear-git secrets add <local-file> [--name <path>]', 1)
  
  let name = basename(filePath)
  const nameIdx = args.indexOf('--name')
  if (nameIdx !== -1 && args[nameIdx + 1]) {
    name = args[nameIdx + 1]
  }
  validateSecretPath(name)

  const content = await readFile(filePath)
  const db = await getSecretsDb(corestore)
  const secretsView = repo.secretsView

  let secretsKey = await getMySecretsKey(secretsView, identity)
  let version = 0

  if (!secretsKey) {
    const versionEntry = await secretsView.get('secrets-key-version')
    version = versionEntry ? versionEntry.value : 0
    
    if (version === 0) {
      // First-use key generation
      secretsKey = Buffer.allocUnsafe(32)
      sodium.randombytes_buf(secretsKey)
      version = 1
      
      const envelope = sealKey(secretsKey, identity.publicKey)
      await repo.appendOp({
        op: 'secrets-key-envelope',
        recipientKey: identity.publicKey,
        encryptedKey: envelope,
        keyVersion: version
      })
    } else {
      throw new CliError('no secrets key available (key exists but no envelope found for you)', 2)
    }
  } else {
    const versionEntry = await secretsView.get('secrets-key-version')
    version = versionEntry ? versionEntry.value : 1
  }

  const { nonce, ciphertext } = encryptFile(content, secretsKey)
  
  const versionBuf = Buffer.allocUnsafe(4)
  versionBuf.writeUInt32LE(version, 0)
  const value = Buffer.concat([versionBuf, nonce, ciphertext])
  
  await db.put('files/' + name, value)
  out.write(`Added ${name} (key version: ${version})\n`)
}

export async function runGet (args, opts) {
  const { repo, identity, corestore, streams } = opts
  const out = streams?.stdout || process.stdout
  
  const name = args[0]
  if (!name) throw new CliError('usage: pear-git secrets get <path> [--output <local-file>]', 1)
  
  const db = await getSecretsDb(corestore)
  const entry = await db.get('files/' + name)
  if (!entry) throw new CliError(`secret not found: ${name}`, 2)

  const fileKeyVersion = entry.value.readUInt32LE(0)
  const nonce = entry.value.slice(4, 28)
  const ciphertext = entry.value.slice(28)

  const secretsKey = await getMySecretsKey(repo.secretsView, identity)
  if (!secretsKey) throw new CliError('no secrets key available', 2)
  
  // Check version mismatch
  const versionEntry = await repo.secretsView.get('secrets-key-version')
  const currentVersion = versionEntry ? versionEntry.value : 0
  
  if (fileKeyVersion !== currentVersion) {
    throw new CliError(`key version mismatch (file: ${fileKeyVersion}, current: ${currentVersion}) — rotation in progress, retry shortly`, 2)
  }

  const plaintext = decryptFile(nonce, ciphertext, secretsKey)
  if (!plaintext) throw new CliError('decryption failed', 2)

  const outIdx = args.indexOf('--output')
  if (outIdx !== -1 && args[outIdx + 1]) {
    await writeFile(args[outIdx + 1], plaintext)
  } else {
    out.write(plaintext)
  }
}

export async function runList (args, opts) {
  const { repo, identity, corestore, streams } = opts
  const out = streams?.stdout || process.stdout
  
  const secretsKey = await getMySecretsKey(repo.secretsView, identity)
  if (!secretsKey) throw new CliError('no secrets key available', 2)

  const db = await getSecretsDb(corestore)
  const paths = []
  for await (const entry of db.createReadStream({ gt: 'files/', lt: 'files/\uffff' })) {
    paths.push(entry.key.slice('files/'.length))
  }

  if (args.includes('--json')) {
    out.write(JSON.stringify(paths) + '\n')
  } else {
    for (const p of paths) {
      out.write(p + '\n')
    }
  }
}

export async function runRm (args, opts) {
  const { repo, identity, corestore, streams } = opts
  const out = streams?.stdout || process.stdout
  
  if (!repo.isWriter(identity.publicKey)) {
    throw new CliError('not a writer', 2)
  }

  const name = args[0]
  if (!name) throw new CliError('usage: pear-git secrets rm <path>', 1)

  const db = await getSecretsDb(corestore)
  const entry = await db.get('files/' + name)
  if (!entry) throw new CliError(`secret not found: ${name}`, 2)

  await db.del('files/' + name)
  out.write(`Removed ${name}\n`)
}

export async function runRotate (args, opts) {
  const { repo, identity, corestore, streams } = opts
  const out = streams?.stdout || process.stdout
  
  if (!repo.isIndexer(identity.publicKey)) {
    throw new CliError('only indexers can rotate keys', 2)
  }

  const secretsView = repo.secretsView
  const oldSecretsKey = await getMySecretsKey(secretsView, identity)
  if (!oldSecretsKey) throw new CliError('no secrets key exists yet', 2)

  const versionEntry = await secretsView.get('secrets-key-version')
  const oldVersion = versionEntry ? versionEntry.value : 1
  const newVersion = oldVersion + 1

  const newSecretsKey = Buffer.allocUnsafe(32)
  sodium.randombytes_buf(newSecretsKey)

  const db = await getSecretsDb(corestore)
  let count = 0

  // Re-encrypt all files
  for await (const entry of db.createReadStream({ gt: 'files/', lt: 'files/\uffff' })) {
    const nonceOld = entry.value.slice(4, 28)
    const ciphertextOld = entry.value.slice(28)
    const plaintext = decryptFile(nonceOld, ciphertextOld, oldSecretsKey)
    
    if (plaintext) {
      const { nonce, ciphertext } = encryptFile(plaintext, newSecretsKey)
      const versionBuf = Buffer.allocUnsafe(4)
      versionBuf.writeUInt32LE(newVersion, 0)
      const newValue = Buffer.concat([versionBuf, nonce, ciphertext])
      await db.put(entry.key, newValue)
      count++
    }
  }

  // Issue rotation op
  await repo.appendOp({
    op: 'secrets-key-rotate',
    newKeyVersion: newVersion
  })

  // Issue envelopes for all writers
  const writers = await repo.getWriters()
  for (const writer of writers) {
    const envelope = sealKey(newSecretsKey, writer.key)
    await repo.appendOp({
      op: 'secrets-key-envelope',
      recipientKey: writer.key,
      encryptedKey: envelope,
      keyVersion: newVersion
    })
  }

  out.write(`Rotated to key version ${newVersion}. Re-encrypted ${count} files.\n`)
}
