import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Corestore from 'corestore'
import bs58 from 'bs58'
import pino from 'pino'
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
  
  // Use a shared corestore for all seeded repos?
  // Architecture says: stores/<repoKey>
  // But seeding multiple repos might mean multiple corestores.
  // Actually, Hyperswarm can handle multiple topics with one instance.
  // We'll open one corestore at a generic 'seeder' path or use a main one.
  // For simplicity and following the project's pattern, let's use a generic seeder store.
  const corestore = new Corestore(join(dataDir, 'seeder'))
  await corestore.ready()

  const swarm = opts.swarm || await createSwarm(corestore)

  const cleanup = async () => {
    await swarm.destroy()
    await corestore.close()
    if (!opts.signal) process.exit(0)
  }

  if (opts.signal) {
    opts.signal.addEventListener('abort', cleanup, { once: true })
  } else {
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  }

  const emitEvent = (obj) => {
    if (human) {
      const time = new Date(obj.time || Date.now()).toLocaleTimeString()
      if (obj.event === 'peer-joined') {
        out.write(`[${time}] Peer joined ${obj.repoKey} (${obj.peerId})\n`)
      } else if (obj.event === 'peer-left') {
        out.write(`[${time}] Peer left ${obj.repoKey} (${obj.peerId})\n`)
      } else if (obj.event === 'blocks-synced') {
        out.write(`[${time}] Synced ${obj.count} blocks for ${obj.repoKey}\n`)
      }
    } else {
      out.write(JSON.stringify(obj) + '\n')
    }
  }

  swarm.on('peer-joined', emitEvent)
  swarm.on('peer-left', emitEvent)
  swarm.on('blocks-synced', emitEvent)

  for (const url of allUrls) {
    try {
      const keyStr = url.slice('pear://'.length)
      const key = Buffer.from(bs58.decode(keyStr))
      await swarm.join(key)
    } catch (err) {
      rootLogger.warn({ url, err: err.message }, 'failed to join repo')
    }
  }

  // Keep alive
  return new Promise((resolve) => {
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => resolve(), { once: true })
    }
  })
}
