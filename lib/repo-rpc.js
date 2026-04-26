// Simple line-delimited JSON RPC over a Unix-domain socket (or named pipe on
// Windows). A running seeder exposes its writable repo over this socket so
// `git push` from a sibling process can append ops via the seeder instead of
// opening its own read-only fallback store (which lacks the writer keys).

import { createServer, connect } from 'node:net'
import { mkdirSync, readdirSync, unlinkSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import bs58 from 'bs58'
import pino from 'pino'

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
    base: { pid: process.pid, component: 'repo-rpc' }
  },
  pino.destination({ fd: 2 })
)

function rpcDir (repoKey) {
  return join(tmpdir(), 'pear-git-rpc', bs58.encode(repoKey))
}

function isWindows () {
  return process.platform === 'win32'
}

function rpcSocketPath (repoKey, pid) {
  if (isWindows()) {
    return `\\\\.\\pipe\\pear-git-rpc-${bs58.encode(repoKey).slice(0, 16)}-${pid}`
  }
  const dir = rpcDir(repoKey)
  mkdirSync(dir, { recursive: true })
  return join(dir, `${pid}.rpc`)
}

function serializeBuffer (b) {
  if (!b) return null
  return { $buf: Buffer.from(b).toString('base64') }
}

function deserializeBuffer (v) {
  if (v && v.$buf) return Buffer.from(v.$buf, 'base64')
  return v
}

function encodeMessage (obj) {
  // Walk object and replace Buffers with {$buf: base64}
  const replace = (val) => {
    if (Buffer.isBuffer(val)) return serializeBuffer(val)
    if (Array.isArray(val)) return val.map(replace)
    if (val && typeof val === 'object') {
      const out = {}
      for (const k of Object.keys(val)) out[k] = replace(val[k])
      return out
    }
    return val
  }
  return JSON.stringify(replace(obj)) + '\n'
}

function decodeMessage (line) {
  const obj = JSON.parse(line)
  const walk = (val) => {
    if (val && typeof val === 'object') {
      if (val.$buf) return deserializeBuffer(val)
      if (Array.isArray(val)) return val.map(walk)
      const out = {}
      for (const k of Object.keys(val)) out[k] = walk(val[k])
      return out
    }
    return val
  }
  return walk(obj)
}

/**
 * Start an RPC server that exposes `repo` to sibling processes.  Returns a
 * close function.
 */
export function startRepoRpcServer (repo, repoKey) {
  const sockPath = rpcSocketPath(repoKey, process.pid)

  // Best-effort cleanup of stale sock from a prior crash of the same pid.
  try { if (!isWindows()) unlinkSync(sockPath) } catch {}

  const server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        handleRequest(line).then(
          (result) => socket.write(encodeMessage({ id: result.id, ok: true, result: result.value })),
          (err) => socket.write(encodeMessage({ id: -1, ok: false, error: err.message }))
        )
      }
    })
    socket.on('error', () => {})
  })
  server.on('error', (err) => rootLogger.warn({ err: err.message }, 'repo rpc server error'))

  async function handleRequest (line) {
    const req = decodeMessage(line)
    const { id, method, params = [] } = req
    try {
      if (!repo[method]) throw new Error('unknown method: ' + method)
      const value = await repo[method](...params)
      return { id, value }
    } catch (err) {
      rootLogger.debug({ method, err: err.message }, 'rpc method threw')
      throw err
    }
  }

  return new Promise((resolve) => {
    server.listen(sockPath, () => {
      rootLogger.info({ sockPath }, 'repo RPC server listening')
      resolve({
        sockPath,
        async close () {
          await new Promise(r => server.close(r))
          try { if (!isWindows()) unlinkSync(sockPath) } catch {}
        }
      })
    })
  })
}

/**
 * List candidate RPC sockets for `repoKey` that are currently live.
 */
export function listRepoRpcSockets (repoKey) {
  if (isWindows()) {
    // Windows named pipes can't be enumerated easily; rely on a lockfile
    // registry under tmp dir. For now, caller passes expected pid list.
    try {
      const dir = join(tmpdir(), 'pear-git-rpc-registry', bs58.encode(repoKey))
      return readdirSync(dir).map(name => {
        const pid = Number(name.replace(/\.pid$/, ''))
        return `\\\\.\\pipe\\pear-git-rpc-${bs58.encode(repoKey).slice(0, 16)}-${pid}`
      })
    } catch { return [] }
  }
  try {
    const dir = rpcDir(repoKey)
    return readdirSync(dir).filter(n => n.endsWith('.rpc')).map(n => join(dir, n))
  } catch { return [] }
}

/**
 * Register a PID in a Windows-readable registry so siblings can discover
 * named pipes. No-op on non-Windows.
 */
export function registerRpcPid (repoKey, pid) {
  if (!isWindows()) return () => {}
  const dir = join(tmpdir(), 'pear-git-rpc-registry', bs58.encode(repoKey))
  mkdirSync(dir, { recursive: true })
  const marker = join(dir, `${pid}.pid`)
  try { writeFileSync(marker, String(pid)) } catch {}
  return () => { try { unlinkSync(marker) } catch {} }
}

/**
 * Connect to an RPC socket and return a promise-based proxy object.
 */
export async function connectRepoRpc (sockPath) {
  const socket = await new Promise((resolve, reject) => {
    const s = connect(sockPath)
    s.once('connect', () => {
      s.removeAllListeners('error')
      resolve(s)
    })
    s.once('error', reject)
  })

  let nextId = 1
  const pending = new Map()
  let buffer = ''

  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = decodeMessage(line) } catch { continue }
      const cb = pending.get(msg.id)
      if (!cb) continue
      pending.delete(msg.id)
      if (msg.ok) cb.resolve(msg.result)
      else cb.reject(new Error(msg.error))
    }
  })

  socket.on('close', () => {
    for (const [, cb] of pending) cb.reject(new Error('RPC socket closed'))
    pending.clear()
  })
  socket.on('error', () => {})

  function call (method, ...params) {
    const id = nextId++
    const payload = encodeMessage({ id, method, params })
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.write(payload)
    })
  }

  return {
    call,
    async close () {
      socket.end()
    }
  }
}

/**
 * Wrap an RPC client as a drop-in replacement for a local `repo` object.
 * Exposes only the methods actually used by the remote-helper push/fetch
 * paths. Read methods can also be served from a local corestore fallback
 * via `localRepo` — if provided, reads prefer local but writes always go
 * over RPC so they land on the writable Autobase instance.
 */
export function createRpcRepoProxy (client, localRepo = null) {
  const rpcCall = (m, ...a) => client.call(m, ...a)

  return {
    // Local reads for speed when possible; RPC as fallback.
    async getRef (ref) {
      if (localRepo) {
        try { return await localRepo.getRef(ref) } catch {}
      }
      return rpcCall('getRef', ref)
    },
    async getSecretFile (path) {
      return rpcCall('getSecretFile', path)
    },
    async listSecretFiles () {
      return rpcCall('listSecretFiles')
    },
    async hasSecretFile (path) {
      return rpcCall('hasSecretFile', path)
    },
    async getSecretsKeyVersion () {
      return rpcCall('getSecretsKeyVersion')
    },
    async getSecretsKeyEnvelope (pubHex) {
      return rpcCall('getSecretsKeyEnvelope', pubHex)
    },
    async listRefs () {
      return rpcCall('listRefs')
    },
    async getStatusSnapshot () {
      return rpcCall('getStatusSnapshot')
    },
    async getWriters () {
      return rpcCall('getWriters')
    },
    async hasObject (sha) {
      if (localRepo) {
        try { return await localRepo.hasObject(sha) } catch {}
      }
      return rpcCall('hasObject', sha)
    },
    async getObject (sha) {
      if (localRepo) {
        try {
          const v = await localRepo.getObject(sha)
          if (v) return v
        } catch {}
      }
      return rpcCall('getObject', sha)
    },

    // Writes always go over RPC.
    async updateRef (ref, oldSha, newSha, force) {
      return rpcCall('updateRef', ref, oldSha, newSha, force)
    },
    async putObject (sha, bytes) {
      return rpcCall('putObject', sha, bytes)
    },
    async addWriter (pubkey, indexer) {
      return rpcCall('addWriter', pubkey, indexer)
    },
    async removeWriter (pubkey) {
      return rpcCall('removeWriter', pubkey)
    },
    async appendOp (op) {
      return rpcCall('appendOp', op)
    },
    async update () {
      if (localRepo) {
        try { await localRepo.update() } catch {}
      }
      return rpcCall('update')
    },
    get view () {
      if (!localRepo) throw new Error('view access requires local repo')
      return localRepo.view
    },
    get key () {
      return localRepo?.key
    },
    get localKey () {
      return localRepo?.localKey
    },
    async close () {
      await client.close()
    }
  }
}
