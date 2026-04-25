import { mkdir, readFile, writeFile, stat, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import sodium from 'sodium-native'
import pino from 'pino'

const rootLogger = pino({
  level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
  redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
  base: { pid: process.pid }
}, pino.destination({ fd: 2 }))

const log = rootLogger.child({ component: 'identity' })

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_128 = /^[0-9a-f]{128}$/
const IDENTITY_FILE_MODE = 0o600

/**
 * @param {string} [dataDir]
 * @returns {Promise<{publicKey: Buffer, sign: function, verify: function, openKeyEnvelope: function}>}
 */
export async function loadIdentity(dataDir) {
  const dir = dataDir || process.env.PEAR_GIT_DATA_DIR || join(homedir(), '.pear-git')
  await mkdir(dir, { recursive: true })

  const identityPath = join(dir, 'identity')
  const exists = await fileExists(identityPath)
  const { publicKeyBuf, secretKeyBuf } = exists
    ? await readExisting(identityPath)
    : await generateNew(identityPath)

  return buildIdentityObject(publicKeyBuf, secretKeyBuf)
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function readExisting(identityPath) {
  await checkPermissions(identityPath)

  const content = await readFile(identityPath, 'utf-8')
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`corrupted identity file: invalid JSON at ${identityPath}`)
    }
    throw err
  }

  validateParsedIdentity(parsed)

  const publicKeyBuf = Buffer.from(parsed.publicKey, 'hex')
  const secretKeyBuf = Buffer.from(parsed.secretKey, 'hex')

  log.info({ publicKey: parsed.publicKey }, 'identity loaded from disk')
  return { publicKeyBuf, secretKeyBuf }
}

function validateParsedIdentity(parsed) {
  if (!parsed.publicKey || !HEX_64.test(parsed.publicKey)) {
    throw new Error('Corrupted identity file: publicKey must be a 64-char hex string')
  }
  if (!parsed.secretKey || !HEX_128.test(parsed.secretKey)) {
    throw new Error('Corrupted identity file: secretKey must be a 128-char hex string')
  }
}

async function checkPermissions(identityPath) {
  const stats = await stat(identityPath)
  const mode = stats.mode & 0o777
  if (mode !== IDENTITY_FILE_MODE) {
    log.warn(
      { path: identityPath, expected: '0600', actual: '0' + mode.toString(8) },
      'identity file permissions are not 0600'
    )
  }
}

async function generateNew(identityPath) {
  const publicKeyBuf = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKeyBuf = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKeyBuf, secretKeyBuf)

  const identity = {
    publicKey: publicKeyBuf.toString('hex'),
    secretKey: secretKeyBuf.toString('hex'),
    createdAt: new Date().toISOString()
  }

  await writeFile(identityPath, JSON.stringify(identity, null, 2) + '\n', { mode: IDENTITY_FILE_MODE })
  await chmod(identityPath, IDENTITY_FILE_MODE)

  log.info({ publicKey: identity.publicKey }, 'new identity generated')
  return { publicKeyBuf, secretKeyBuf }
}

function buildIdentityObject(publicKeyBuf, secretKeyBuf) {
  return {
    publicKey: publicKeyBuf,

    sign(data) {
      const sig = Buffer.allocUnsafe(sodium.crypto_sign_BYTES)
      sodium.crypto_sign_detached(sig, data, secretKeyBuf)
      return sig
    },

    verify(sig, data, pubkey) {
      return sodium.crypto_sign_verify_detached(sig, data, pubkey)
    },

    openKeyEnvelope(encryptedKey) {
      const curveSecret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
      const curvePublic = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
      sodium.crypto_sign_ed25519_sk_to_curve25519(curveSecret, secretKeyBuf)
      sodium.crypto_sign_ed25519_pk_to_curve25519(curvePublic, publicKeyBuf)

      const decrypted = Buffer.allocUnsafe(
        encryptedKey.byteLength - sodium.crypto_box_SEALBYTES
      )
      const success = sodium.crypto_box_seal_open(decrypted, encryptedKey, curvePublic, curveSecret)
      return success ? decrypted : null
    }
  }
}
