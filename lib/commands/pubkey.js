import { CliError } from './cli-error.js'

const PUBKEY_RE = /^[0-9a-f]{64}$/

/**
 * Validate a 64-char hex string pubkey. On failure writes a user-facing error
 * to stderr and throws CliError(2). Returns the 32-byte Buffer on success.
 *
 * @param {string | undefined} pubkeyHex
 * @param {{ write: (s: string) => void }} stderr
 * @returns {Buffer}
 */
export function validatePubkey (pubkeyHex, stderr) {
  if (!pubkeyHex || !PUBKEY_RE.test(pubkeyHex)) {
    stderr.write('pear-git: error: invalid public key (expected 64-char hex)\n')
    throw new CliError('invalid public key', 2)
  }
  return Buffer.from(pubkeyHex, 'hex')
}

/**
 * Short 8-char hex prefix used for human-readable CLI output.
 *
 * @param {Buffer} pubkey
 * @returns {string}
 */
export function shortKey (pubkey) {
  return pubkey.toString('hex').slice(0, 8)
}
