import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Corestore from 'corestore'
import bs58 from 'bs58'
import pino from 'pino'
import { loadIdentity } from '../identity.js'
import { openRepo } from '../autobase-repo.js'
import { createSwarm } from '../swarm.js'

const execFileAsync = promisify(execFile)

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'warn',
    base: { component: 'cli-seed' }
  },
  pino.destination({ fd: 2 })
)

async function detectOriginUrl () {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: process.cwd() })
    const url = stdout.trim()
    if (url.startsWith('pear://')) return url
  } catch { /* not in a pear-git repo */ }
  return null
}

export async function run (args, opts = {}) {
  const out = opts.output || process.stdout
  const human = args.includes('--human')
  const repoUrls = args.filter(a => a.startsWith('pear://'))

  const envKeys = process.env.PEAR_GIT_SEEDER_KEYS
    ? process.env.PEAR_GIT_SEEDER_KEYS.split(',').map(s => s.trim())
    : []

  const allUrls = [...repoUrls, ...envKeys]

  if (allUrls.length === 0) {
    const detected = await detectOriginUrl()
    if (detected) {
      allUrls.push(detected)
      process.stderr.write(`Seeding current repo: ${detected}\n`)
    }
  }

  if (allUrls.length === 0) {
    if (opts.signal) return
    throw new Error('no repos to seed — pass a pear:// URL or run inside a pear-git repo')
  }

  const dataDir = opts.dataDir || process.env.PEAR_GIT_DATA_DIR || join(homedir(), '.pear-git')
  const identity = opts.swarm ? null : await loadIdentity(dataDir)

  const corestores = []
  const repos = []
  const swarms = []

  const cleanup = async () => {
    for (const s of swarms) await s.destroy().catch(() => {})
    for (const r of repos) await r.close().catch(() => {})
    for (const cs of corestores) await cs.close().catch(() => {})
    if (!opts.signal) process.exit(0)
  }

  if (opts.signal) {
    opts.signal.addEventListener('abort', cleanup, { once: true })
  } else {
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  }

  for (const url of allUrls) {
    try {
      const keyStr = url.replace(/^pear:\/\//, '')
      const repoKey = Buffer.from(bs58.decode(keyStr))
      const storePath = join(dataDir, 'stores', bs58.encode(repoKey))

      let corestore = null
      let repo = null
      let ref = null
      let swarm = null

      if (opts.swarm) {
        swarm = opts.swarm
        swarms.push(swarm)
        await swarm.join(repoKey)
      } else {
        corestore = new Corestore(storePath)
        await corestore.ready()
        corestores.push(corestore)

        // Open the repo BEFORE joining the swarm. This ensures the
        // Autobase cores (_primaryBootstrap, _local, system, view) are
        // registered with the corestore before any replication stream
        // attaches, so the initial protomux announcement includes them.
        repo = await openRepo(corestore, identity, { key: repoKey })
        repos.push(repo)
        await repo.update()

        ref = await repo.getRef('refs/heads/master') || await repo.getRef('refs/heads/main')

        swarm = await createSwarm(corestore)
        swarms.push(swarm)
        await swarm.join(repoKey)
      }

      const emitEvent = (obj) => {
        if (human) {
          const time = new Date(obj.time || Date.now()).toLocaleTimeString()
          if (obj.event === 'peer-joined') {
            out.write(`[${time}] Peer joined (${obj.peerId?.slice(0, 8)}...)\n`)
          } else if (obj.event === 'peer-left') {
            out.write(`[${time}] Peer left (${obj.peerId?.slice(0, 8)}...)\n`)
          } else if (obj.event === 'blocks-synced') {
            out.write(`[${time}] Synced ${obj.count} blocks\n`)
          }
        } else {
          out.write(JSON.stringify(obj) + '\n')
        }
      }

      swarm.on('peer-joined', emitEvent)
      swarm.on('peer-left', emitEvent)
      swarm.on('blocks-synced', emitEvent)

      if (human) {
        out.write(`Seeding ${keyStr.slice(0, 8)}... (HEAD: ${ref || 'none'})\n`)
      }
    } catch (err) {
      rootLogger.warn({ url, err: err.message }, 'failed to seed repo')
      process.stderr.write(`Failed to seed ${url}: ${err.message}\n`)
    }
  }

  if (human) {
    out.write(`\nReady. Waiting for peers... (Ctrl+C to stop)\n`)
  }

  return new Promise((resolve) => {
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => resolve(), { once: true })
    }
  })
}
