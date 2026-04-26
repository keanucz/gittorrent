import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
export async function loadRepoForCwd (opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const dataDir = opts.dataDir || process.env.PEAR_GIT_DATA_DIR || join(homedir(), '.pear-git')

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
      const candidates = listRepoRpcSockets(key)
      for (const sockPath of candidates) {
        try {
          rpcClient = await connectRepoRpc(sockPath)
          break
        } catch {}
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
