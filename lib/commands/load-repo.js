import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import bs58 from 'bs58'
import Corestore from 'corestore'
import { loadIdentity } from '../identity.js'
import { openRepo } from '../autobase-repo.js'
import { listRepoRpcSockets, connectRepoRpc, createRpcRepoProxy } from '../repo-rpc.js'

const execFileAsync = promisify(execFile)

/**
 * Resolve the pear:// repo URL from the current git working tree by reading
 * the `origin` remote URL.
 *
 * @param {string} cwd
 * @returns {Promise<string>} the pear:// URL
 */
async function readOriginUrl (cwd) {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd })
  const url = stdout.trim()
  if (!url.startsWith('pear://')) {
    throw new Error(`origin is not a pear-git remote: ${url}`)
  }
  return url
}

/**
 * Decode a pear:// URL into the 32-byte repo key.
 *
 * @param {string} url
 * @returns {Buffer}
 */
function decodeRepoKey (url) {
  const encoded = url.replace(/^pear:\/\//, '')
  return Buffer.from(bs58.decode(encoded))
}

/**
 * Open the Corestore + Autobase repo for the current working directory. Used
 * by CLI subcommands that operate on an already-initialised repo.
 *
 * @param {{ cwd?: string, dataDir?: string }} [opts]
 * @returns {Promise<{ repo: object, identity: object, close: () => Promise<void> }>}
 */
/**
 * Spawn `pear-git seed -d` in the background. Returns when a seeder RPC
 * socket for `key` becomes available, or times out.
 */
async function autoStartSeeder (key, timeoutMs = 5000) {
  // Locate the pear-git binary. We're in lib/commands/load-repo.js so the
  // bin lives at ../../bin/pear-git relative to this file.
  const here = fileURLToPath(import.meta.url)
  const pearGitBin = join(here, '..', '..', '..', 'bin', 'pear-git')

  const child = spawn(process.execPath, [pearGitBin, 'seed'], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  })
  child.unref()

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sockets = listRepoRpcSockets(key)
    for (const sockPath of sockets) {
      try {
        const client = await connectRepoRpc(sockPath)
        return client
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return null
}

export async function loadRepoForCwd (opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const dataDir = opts.dataDir || process.env.PEAR_GIT_DATA_DIR || join(homedir(), '.pear-git')
  const autoSpawn = opts.autoSpawnSeeder !== false && process.env.PEAR_GIT_NO_AUTO_SEED !== '1'

  const url = await readOriginUrl(cwd)
  const key = decodeRepoKey(url)
  const storePath = join(dataDir, 'stores', bs58.encode(key))

  const identity = await loadIdentity(dataDir)

  // Try to open the corestore. If it's locked by a running seeder, fall
  // back to the seeder's RPC socket instead of exploding.
  let corestore = null
  let repo = null
  let rpcClient = null
  try {
    corestore = new Corestore(storePath)
    await corestore.ready()
    repo = await openRepo(corestore, identity, { key })
  } catch (err) {
    if (err && err.code === 'ELOCKED') {
      // First try an existing RPC socket.
      const candidates = listRepoRpcSockets(key)
      for (const sockPath of candidates) {
        try {
          rpcClient = await connectRepoRpc(sockPath)
          break
        } catch {}
      }
      // If none found and we're allowed to, spawn a seeder in the
      // background and wait for it to come up.
      if (!rpcClient && autoSpawn) {
        process.stderr.write('pear-git: store is locked; starting background seeder...\n')
        rpcClient = await autoStartSeeder(key)
      }
      if (!rpcClient) {
        throw new Error('repo is in use by another process and no seeder RPC is available')
      }
      repo = createRpcRepoProxy(rpcClient, null)
    } else {
      throw err
    }
  }

  return {
    repo,
    identity,
    corestore,
    async close () {
      if (rpcClient) try { await rpcClient.close() } catch {}
      if (repo && !rpcClient) await repo.close()
      if (corestore) await corestore.close()
    }
  }
}
