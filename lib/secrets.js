import sodium from 'sodium-native'
import pino from 'pino'

const rootLogger = pino({
  level: process.env.GITTORRENT_LOG_LEVEL || 'info',
  redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
  base: { pid: process.pid }
}, pino.destination({ fd: 2 }))

const log = rootLogger.child({ component: 'secrets' })

/**
 * Derive an X25519 public key from an ed25519 public key.
 * @param {Buffer} ed25519Pub - 32-byte ed25519 public key
 * @returns {Buffer} 32-byte X25519 public key
 */
export function deriveX25519Pub (ed25519Pub) {
  const x25519Pub = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(x25519Pub, ed25519Pub)
  return x25519Pub
}

/**
 * Derive an X25519 secret key from an ed25519 secret key.
 * @param {Buffer} ed25519Secret - 64-byte ed25519 secret key
 * @returns {Buffer} 32-byte X25519 secret key
 */
export function deriveX25519Secret (ed25519Secret) {
  const x25519Secret = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_sign_ed25519_sk_to_curve25519(x25519Secret, ed25519Secret)
  return x25519Secret
}

/**
 * Seal (encrypt) a secrets key for a specific recipient using their ed25519 public key.
 * @param {Buffer} secretsKey - the symmetric key to seal
 * @param {Buffer} recipientEd25519Pub - recipient's ed25519 public key
 * @returns {Buffer} sealed envelope (secretsKey.length + crypto_box_SEALBYTES bytes)
 */
export function sealKey (secretsKey, recipientEd25519Pub) {
  const x25519RecipientPub = deriveX25519Pub(recipientEd25519Pub)
  const ciphertext = Buffer.allocUnsafe(secretsKey.length + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(ciphertext, secretsKey, x25519RecipientPub)
  log.debug({ recipientPubKeyHex: recipientEd25519Pub.toString('hex') }, 'sealed secrets key for recipient')
  return ciphertext
}

/**
 * Open (decrypt) a sealed key envelope using the recipient's ed25519 keypair.
 * @param {Buffer} envelope - sealed envelope
 * @param {Buffer} myEd25519Pub - recipient's ed25519 public key
 * @param {Buffer} myEd25519Secret - recipient's ed25519 secret key
 * @returns {Buffer|null} decrypted key, or null if decryption fails
 */
export function openKey (envelope, myEd25519Pub, myEd25519Secret) {
  const x25519Pub = deriveX25519Pub(myEd25519Pub)
  const x25519Secret = deriveX25519Secret(myEd25519Secret)
  const opened = Buffer.allocUnsafe(envelope.length - sodium.crypto_box_SEALBYTES)
  const ok = sodium.crypto_box_seal_open(opened, envelope, x25519Pub, x25519Secret)
  if (!ok) {
    log.debug('failed to open key envelope')
    return null
  }
  log.debug('successfully opened key envelope')
  return opened
}

/**
 * Encrypt a plaintext buffer with a symmetric secrets key.
 * @param {Buffer} plaintext - data to encrypt
 * @param {Buffer} secretsKey - 32-byte symmetric key
 * @returns {{ nonce: Buffer, ciphertext: Buffer }}
 */
export function encryptFile (plaintext, secretsKey) {
  const nonce = Buffer.allocUnsafe(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const ciphertext = Buffer.allocUnsafe(plaintext.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, secretsKey)
  log.debug({ plaintextLength: plaintext.length }, 'encrypted file')
  return { nonce, ciphertext }
}

/**
 * Decrypt a ciphertext buffer with a symmetric secrets key.
 * @param {Buffer} nonce - 24-byte nonce
 * @param {Buffer} ciphertext - encrypted data
 * @param {Buffer} secretsKey - 32-byte symmetric key
 * @returns {Buffer|null} decrypted plaintext, or null if decryption fails
 */
export function decryptFile (nonce, ciphertext, secretsKey) {
  const plaintext = Buffer.allocUnsafe(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
  const ok = sodium.crypto_secretbox_open_easy(plaintext, ciphertext, nonce, secretsKey)
  if (!ok) {
    log.debug('failed to decrypt file')
    return null
  }
  log.debug({ plaintextLength: plaintext.length }, 'decrypted file')
  return plaintext
}

/**
 * Retrieve and decrypt this peer's secrets key from the Autobase view.
 * @param {object} autobaseView - Hyperbee-like view with async get(key)
 * @param {object} identity - identity object with publicKey and openKeyEnvelope
 * @returns {Promise<Buffer|null>} decrypted secrets key, or null if unavailable
 */
export async function getMySecretsKey (repoOrView, identity) {
  const pubHex = identity.publicKey.toString('hex')
  let envelope = null
  // Prefer the RPC-friendly method on the new repo API.
  if (repoOrView && typeof repoOrView.getSecretsKeyEnvelope === 'function') {
    envelope = await repoOrView.getSecretsKeyEnvelope(pubHex)
  } else if (repoOrView && typeof repoOrView.get === 'function') {
    const entry = await repoOrView.get('secrets-key/' + pubHex)
    envelope = entry ? entry.value : null
  } else if (repoOrView && repoOrView.secretsView) {
    const entry = await repoOrView.secretsView.get('secrets-key/' + pubHex)
    envelope = entry ? entry.value : null
  }
  if (!envelope) {
    log.debug({ publicKeyHex: pubHex }, 'no secrets key envelope found')
    return null
  }
  const encryptedKey = Buffer.isBuffer(envelope.encryptedKey)
    ? envelope.encryptedKey
    : Buffer.from(envelope.encryptedKey, 'hex')
  const opened = identity.openKeyEnvelope(encryptedKey)
  if (!opened) {
    log.warn({ publicKeyHex: pubHex }, 'failed to open secrets key envelope')
    return null
  }
  log.debug('successfully retrieved secrets key')
  return opened
}
