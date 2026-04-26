import pino from 'pino'
import { CliError } from './cli-error.js'

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
    redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
    base: { pid: process.pid }
  },
  pino.destination({ fd: 2 })
)

const log = rootLogger.child({ component: 'cli' })

/**
 * Gather secrets info from the repo's secretsView.
 *
 * @param {object} secretsView
 * @returns {Promise<{ keyVersion: number, fileCount: number, hasKey: boolean }>}
 */
async function gatherSecrets (secretsView) {
  const versionEntry = await secretsView.get('secrets-key-version')
  const keyVersion = versionEntry?.value ?? 0
  const hasKey = keyVersion > 0

  let fileCount = 0
  if (hasKey) {
    for await (const _entry of secretsView.createReadStream()) { // eslint-disable-line no-unused-vars
      fileCount++
    }
  }

  return { keyVersion, fileCount, hasKey }
}

/**
 * Count rejected pushes from the rejections sub-bee.
 *
 * @param {object} view
 * @returns {Promise<number>}
 */
async function countRejections (view) {
  let rejectedPushes = 0
  for await (const _entry of view.sub('rejections').createReadStream()) { // eslint-disable-line no-unused-vars
    rejectedPushes++
  }
  return rejectedPushes
}

/**
 * Gather all status data from repo and swarm.
 *
 * @param {object} repo
 * @param {object} swarm
 * @returns {Promise<object>}
 */
async function gatherStatus (repo, swarm) {
  const peers = swarm.connectedPeers(repo.key)
  const signedLength = repo.signedLength
  const pendingOps = repo.pendingLength

  const writers = await repo.getWriters()
  const total = writers.length
  const indexers = writers.filter(w => w.indexer).length

  const rejectedPushes = await countRejections(repo.view)
  const secrets = await gatherSecrets(repo.secretsView)

  return {
    repo: repo.key.toString('hex'),
    repoKey: repo.key.toString('hex'),
    peers,
    signedLength,
    pendingOps,
    rejectedPushes,
    writers: total,
    indexers,
    secrets,
    lastError: null // TODO: implement error tracking if needed
  }
}

/**
 * Write human-readable status output.
 *
 * @param {object} status
 * @param {{ write: (s: string) => void }} output
 */
function writeHuman (status, output) {
  const { repoKey, peers, signedLength, pendingOps, rejectedPushes, writers, indexers, secrets } = status

  output.write(`Repo: pear://${repoKey}\n`)
  output.write(`Peers: ${peers} connected\n`)
  output.write(`Signed length: ${signedLength}\n`)
  output.write(`Pending ops: ${pendingOps}\n`)
  output.write(`Rejected pushes: ${rejectedPushes}\n`)
  output.write(`Writers: ${writers} (${indexers} indexer)\n`)

  if (secrets.hasKey) {
    output.write(`Secrets: key v${secrets.keyVersion}, ${secrets.fileCount} files\n`)
  } else {
    output.write('Secrets: none\n')
  }
}

/**
 * Implement `pear-git status [--json]`.
 *
 * @param {string[]} args
 * @param {object} opts
 * @param {object|null} opts.repo
 * @param {object} opts.swarm
 * @param {{ write: (s: string) => void }} [opts.output]
 * @param {{ write: (s: string) => void }} [opts.stderr]
 * @returns {Promise<void>}
 */
export async function run (args, opts = {}) {
  const { repo, swarm } = opts
  const output = opts.output || process.stdout
  const stderr = opts.stderr || process.stderr
  const useJson = args.includes('--json')

  if (repo == null) {
    throw new CliError('not a pear-git repository', 1)
  }

  log.debug({ repoKey: repo.key.toString('hex') }, 'gathering status')
  const status = await gatherStatus(repo, swarm)

  if (useJson) {
    output.write(JSON.stringify(status) + '\n')
  } else {
    writeHuman(status, output)
  }

  if (status.peers === 0) {
    stderr.write('pear-git: error: no peers connected\n')
    throw new CliError('no peers connected', 3)
  }
}
