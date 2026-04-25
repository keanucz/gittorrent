import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import pino from 'pino'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

const SHA_RE = /^[0-9a-f]{40}$/

/**
 * Validates that a string is a 40-char lowercase hex SHA.
 * @param {string} sha
 * @throws {TypeError} if invalid
 */
function validateSha (sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
    throw new TypeError(`Invalid SHA: ${sha}`)
  }
}

const defaultLog = pino({
  level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
  redact: ['identity.secretKey', 'secretKey', '*.secretKey'],
  base: { pid: process.pid }
}).child({ component: 'object-store' })

/**
 * Creates a content-addressed object store backed by a Hyperbee.
 * @param {import('hyperbee')} db - A Hyperbee instance (utf-8 keys, binary values)
 * @returns {ObjectStore}
 */
export function createObjectStore (db) {
  // The store object itself. We allow the caller to replace the logger
  // to add context like repoKey.
  const store = {
    log: defaultLog,

    async has (sha) {
      validateSha(sha)
      const entry = await db.get(sha)
      return !!entry
    },

    async get (sha) {
      validateSha(sha)
      const entry = await db.get(sha)

      if (!entry) {
        this.log.debug({ sha, action: 'miss' })
        return null
      }

      this.log.debug({ sha, action: 'get' })
      return await gunzipAsync(entry.value)
    },

    async put (sha, objectBytes) {
      validateSha(sha)
      const gzipped = await gzipAsync(objectBytes)
      await db.put(sha, gzipped)
      this.log.debug({ sha, action: 'put' })
    }
  }

  return store
}
