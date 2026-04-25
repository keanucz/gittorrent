import pino from 'pino'
import { CliError } from './cli-error.js'
import { validatePubkey, shortKey } from './pubkey.js'
import { sealKey as defaultSealKey, getMySecretsKey as defaultGetMySecretsKey } from '../secrets.js'

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
    redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
    base: { pid: process.pid }
  },
  pino.destination({ fd: 2 })
)

const log = rootLogger.child({ component: 'cli' })

const SECRETS_WARNING =
  'warning: could not distribute secrets key — inviter lacks access. ' +
  "New writer will not be able to read secrets until an indexer runs 'pear-git secrets rotate'.\n"

/**
 * Parse `args` into { pubkeyHex, indexer }. Accepts `--indexer` in any position
 * after the pubkey.
 *
 * @param {string[]} args
 * @returns {{ pubkeyHex: string | undefined, indexer: boolean }}
 */
function parseArgs (args) {
  const positional = args.filter(a => !a.startsWith('--'))
  const flags = args.filter(a => a.startsWith('--'))
  return {
    pubkeyHex: positional[0],
    indexer: flags.includes('--indexer')
  }
}

/**
 * Wrap sealKey in a try/catch so a crypto failure on an invalid ed25519 point
 * does not crash the CLI. Logs a warning and returns `null` to signal the
 * caller to skip the envelope op entirely (avoids polluting the view with an
 * unopenable zero-length placeholder).
 *
 * @param {(key: Buffer, recipient: Buffer) => Buffer} sealKeyFn
 * @param {Buffer} secretsKey
 * @param {Buffer} recipient
 * @returns {Buffer|null}
 */
function safeSealKey (sealKeyFn, secretsKey, recipient) {
  try {
    return sealKeyFn(secretsKey, recipient)
  } catch (err) {
    log.warn(
      { recipient: recipient.toString('hex'), error: err.message },
      'sealKey failed; envelope will not be distributed'
    )
    return null
  }
}

/**
 * Distribute the current secrets key to the new writer if the inviter has
 * access to it. Writes a warning to stderr if the inviter lacks the key.
 *
 * @param {object} params
 * @param {object} params.repo
 * @param {object} params.identity
 * @param {Buffer} params.targetBuf
 * @param {(view: object, identity: object) => Promise<Buffer|null>} params.getMySecretsKeyFn
 * @param {(key: Buffer, recipient: Buffer) => Buffer} params.sealKeyFn
 * @param {{ write: (s: string) => void }} params.stderr
 */
async function distributeSecretsKey ({ repo, identity, targetBuf, getMySecretsKeyFn, sealKeyFn, stderr }) {
  const versionEntry = await repo.secretsView.get('secrets-key-version')
  const currentVersion = versionEntry?.value ?? 0
  if (currentVersion === 0) return

  const secretsKey = await getMySecretsKeyFn(repo.secretsView, identity)
  if (!secretsKey) {
    stderr.write(SECRETS_WARNING)
    log.warn({ targetKey: targetBuf.toString('hex') }, 'inviter lacks secrets key, skipping envelope distribution')
    return
  }

  const encryptedKey = safeSealKey(sealKeyFn, secretsKey, targetBuf)
  if (encryptedKey === null) {
    stderr.write(SECRETS_WARNING)
    log.warn(
      { targetKey: targetBuf.toString('hex'), reason: 'sealKey failed' },
      'skipping envelope distribution after sealKey failure'
    )
    return
  }
  await repo.appendOp({
    op: 'secrets-key-envelope',
    recipientKey: targetBuf,
    encryptedKey,
    keyVersion: currentVersion
  })
  log.info(
    { targetKey: targetBuf.toString('hex'), keyVersion: currentVersion },
    'secrets-key-envelope appended for new writer'
  )
}

/**
 * Implement `pear-git invite <pubkey> [--indexer]`.
 *
 * @param {string[]} args
 * @param {object} opts
 * @param {object} opts.repo
 * @param {object} opts.identity
 * @param {{ stdout: { write: (s: string) => void }, stderr: { write: (s: string) => void } }} opts.streams
 * @param {(view: object, identity: object) => Promise<Buffer|null>} [opts.getMySecretsKey]
 * @param {(key: Buffer, recipient: Buffer) => Buffer} [opts.sealKey]
 * @returns {Promise<void>}
 */
export async function run (args, opts) {
  const { streams, repo, identity } = opts
  const { stdout, stderr } = streams
  const getMySecretsKeyFn = opts.getMySecretsKey || defaultGetMySecretsKey
  const sealKeyFn = opts.sealKey || defaultSealKey

  const { pubkeyHex, indexer } = parseArgs(args)
  const targetBuf = validatePubkey(pubkeyHex, stderr)

  const writers = await repo.getWriters()
  const caller = writers.find(w => w.key.equals(identity.publicKey))
  if (!caller || !caller.indexer) {
    stderr.write('pear-git: error: not an indexer — cannot invite writers\n')
    throw new CliError('not an indexer — cannot invite writers', 2)
  }

  const existing = writers.find(w => w.key.equals(targetBuf))
  if (existing) {
    stderr.write(`pear-git: error: ${shortKey(targetBuf)} is already a writer\n`)
    throw new CliError('already a writer', 2)
  }

  await repo.addWriter(targetBuf, { indexer })
  log.info({ targetKey: targetBuf.toString('hex'), indexer }, 'writer invited')

  await distributeSecretsKey({ repo, identity, targetBuf, getMySecretsKeyFn, sealKeyFn, stderr })

  stdout.write(`Invited ${shortKey(targetBuf)}... (indexer: ${indexer ? 'yes' : 'no'})\n`)
}
