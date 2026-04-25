import pino from 'pino'
import { CliError } from './cli-error.js'
import { validatePubkey, shortKey } from './pubkey.js'

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
    redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
    base: { pid: process.pid }
  },
  pino.destination({ fd: 2 })
)

const log = rootLogger.child({ component: 'cli' })

const ROTATION_WARNING =
  'warning: revoked writer retains read access to secrets encrypted before key rotation.\n' +
  "Run 'pear-git secrets rotate' to revoke their access.\n"

/**
 * Guard against removing the last indexer. Writes a stderr message and throws
 * CliError(2) if the target is the sole indexer.
 *
 * @param {Array<{ key: Buffer, indexer: boolean }>} writers
 * @param {{ key: Buffer, indexer: boolean }} target
 * @param {{ write: (s: string) => void }} stderr
 */
function ensureNotLastIndexer (writers, target, stderr) {
  if (!target.indexer) return
  const indexerCount = writers.filter(w => w.indexer).length
  if (indexerCount !== 1) return
  stderr.write('pear-git: error: cannot remove last indexer\n')
  throw new CliError('cannot remove last indexer', 2)
}

/**
 * Implement `pear-git revoke <pubkey>`.
 *
 * @param {string[]} args
 * @param {object} opts
 * @param {object} opts.repo
 * @param {object} opts.identity
 * @param {{ stdout: { write: (s: string) => void }, stderr: { write: (s: string) => void } }} opts.streams
 * @returns {Promise<void>}
 */
export async function run (args, opts) {
  const { streams, repo, identity } = opts
  const { stdout, stderr } = streams

  const [pubkeyHex] = args
  const targetBuf = validatePubkey(pubkeyHex, stderr)

  const writers = await repo.getWriters()
  const caller = writers.find(w => w.key.equals(identity.publicKey))
  if (!caller || !caller.indexer) {
    stderr.write('pear-git: error: not an indexer — cannot revoke writers\n')
    throw new CliError('not an indexer — cannot revoke writers', 2)
  }

  const target = writers.find(w => w.key.equals(targetBuf))
  if (!target) {
    stderr.write(`pear-git: error: ${shortKey(targetBuf)} is not a writer\n`)
    throw new CliError('not a writer', 2)
  }

  ensureNotLastIndexer(writers, target, stderr)

  await repo.removeWriter(targetBuf)
  log.info({ targetKey: targetBuf.toString('hex') }, 'writer revoked')

  stderr.write(ROTATION_WARNING)
  stdout.write(`Revoked ${shortKey(targetBuf)}...\n`)
}
