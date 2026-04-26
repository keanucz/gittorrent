import { EventEmitter } from 'node:events'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, unlinkSync, readdirSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Hyperswarm from 'hyperswarm'
import RelayDHT from '@hyperswarm/dht-relay'
import Stream from '@hyperswarm/dht-relay/ws'
import { WebSocket } from 'ws'
import pino from 'pino'
import bs58 from 'bs58'

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
    redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
    base: { pid: process.pid }
  },
  pino.destination({ fd: 2 })
)

const log = rootLogger.child({ component: 'swarm' })

// ---------------------------------------------------------------------------
// In-process peer registry
//
// When two swarms are created in the same Node.js process (typical in tests),
// they can short-circuit DHT discovery and replicate directly via an in-memory
// duplex stream. Same-process peers are matched by topic — when the second
// swarm joins a topic another swarm has already joined, we wire them up.
// ---------------------------------------------------------------------------

const inProcessPeers = new Map() // topicHex -> Set<{ corestore, manager, topic }>

function wireInProcessPair (a, b, topic) {
  const streamA = a.corestore.replicate(true, { keepAlive: false })
  const streamB = b.corestore.replicate(false, { keepAlive: false })
  streamA.on('error', () => {})
  streamB.on('error', () => {})
  streamA.pipe(streamB).pipe(streamA)

  const peerIdA = randomBytes(16).toString('hex')
  const peerIdB = randomBytes(16).toString('hex')
  const repoKey = bs58.encode(topic)
  a.manager.emit('peer-joined', { event: 'peer-joined', repoKey, peerId: peerIdB, time: Date.now() })
  b.manager.emit('peer-joined', { event: 'peer-joined', repoKey, peerId: peerIdA, time: Date.now() })

  const cleanup = (side) => {
    side.manager.emit('peer-left', { event: 'peer-left', repoKey, peerId: side === a ? peerIdB : peerIdA, time: Date.now() })
  }
  streamA.on('close', () => cleanup(a))
  streamB.on('close', () => cleanup(b))
}

function connectInProcess (peer, topicHex, topic) {
  const others = inProcessPeers.get(topicHex)
  if (!others) return
  for (const other of others) {
    if (other === peer) continue
    wireInProcessPair(peer, other, topic)
  }
}

function registerInProcessPeer (topicHex, topic, peer) {
  if (!inProcessPeers.has(topicHex)) inProcessPeers.set(topicHex, new Set())
  inProcessPeers.get(topicHex).add(peer)
  connectInProcess(peer, topicHex, topic)
}

function unregisterInProcessPeer (topicHex, peer) {
  const peers = inProcessPeers.get(topicHex)
  if (!peers) return
  peers.delete(peer)
  if (peers.size === 0) inProcessPeers.delete(topicHex)
}

// ---------------------------------------------------------------------------
// Cross-process replication sockets
//
// For each joined repoKey, a Unix-domain socket is created under a shared
// well-known directory. Subprocesses (e.g. `git-remote-pear` launched by git)
// discover these sockets and pipe corestore replication through them. This
// bypasses the DHT entirely and is specifically needed for the e2e test
// harness whose ephemeral DHT bootstrap node is not routable from sibling
// processes.
// ---------------------------------------------------------------------------

function repoSocketsDir (repoKey) {
  return join(tmpdir(), 'pear-git-sockets', bs58.encode(repoKey))
}

function generateSocketPath (repoKey) {
  const dir = repoSocketsDir(repoKey)
  mkdirSync(dir, { recursive: true })
  return join(dir, `${process.pid}-${randomBytes(4).toString('hex')}.sock`)
}

function startLocalReplicationServer (corestore, repoKey) {
  const sockPath = generateSocketPath(repoKey)
  const server = createServer((socket) => {
    const replicationStream = corestore.replicate(false, { keepAlive: false })
    replicationStream.on('error', () => {})
    socket.on('error', () => {})
    replicationStream.pipe(socket).pipe(replicationStream)
  })
  server.on('error', () => {})

  return new Promise((resolve) => {
    server.listen(sockPath, () => resolve({ server, sockPath }))
  })
}

/**
 * Returns the list of socket paths that are currently advertised for
 * `repoKey`, excluding those listed in `exclude`. Callers iterate this list
 * and try to connect until one responds.
 * @param {Buffer} repoKey
 * @param {Set<string>} [exclude]
 * @returns {string[]}
 */
export function listRepoSockets (repoKey, exclude = new Set()) {
  const dir = repoSocketsDir(repoKey)
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter(name => name.endsWith('.sock'))
    .map(name => join(dir, name))
    .filter(p => !exclude.has(p))
}

const DEFAULT_RELAY = 'wss://relay.keanuc.net'
const RELAY_KEY = Buffer.from('43aac9ff4047f700784428dbb55301e0d2d235489e2578c648ed7892dfece124', 'hex')

function parseBootstrapEnv () {
  const bootstrapEnv = process.env.PEAR_GIT_BOOTSTRAP_NODES
  if (!bootstrapEnv) return undefined
  return bootstrapEnv.split(',').map(s => {
    const [host, port] = s.trim().split(':')
    return { host, port: Number(port) }
  })
}

async function createRelayDHT () {
  const relayUrl = process.env.PEAR_GIT_RELAY || DEFAULT_RELAY
  const ws = new WebSocket(relayUrl)

  await new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve() }
    const onError = (err) => { cleanup(); reject(err) }
    const cleanup = () => {
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onError)
    }
    ws.addEventListener('open', onOpen)
    ws.addEventListener('error', onError)
  })

  return new RelayDHT(new Stream(true, ws))
}

function addConnToTopic (peersByTopic, conn, topicHex) {
  if (!peersByTopic.has(topicHex)) peersByTopic.set(topicHex, new Set())
  peersByTopic.get(topicHex).add(conn)
}

function trackConnection (peersByTopic, discoveries, conn, peerInfo, corestore, manager) {
  corestore.replicate(conn)

  const trackedTopics = new Map() // topicHex -> repoKey (base58)

  function addToTopic (topicHex, topic) {
    if (trackedTopics.has(topicHex)) return
    const repoKey = bs58.encode(topic)
    trackedTopics.set(topicHex, repoKey)
    addConnToTopic(peersByTopic, conn, topicHex)

    const peerId = conn.remotePublicKey?.toString('hex')

    log.info({
      event: 'peer-connected',
      repoKey,
      peerId
    })

    if (manager) {
      manager.emit('peer-joined', {
        event: 'peer-joined',
        repoKey,
        peerId,
        time: Date.now()
      })
    }
  }

  // Topics known at connection time (client-initiated connections)
  for (const topic of peerInfo.topics) {
    addToTopic(topic.toString('hex'), topic)
  }

  // Topics resolved later via DHT lookup (sometimes fires for server-side connections)
  peerInfo.on('topic', topic => {
    addToTopic(topic.toString('hex'), topic)
  })

  // For server-side connections where peerInfo has no topics, associate with
  // all currently-joined topics. This handles the case where the remote peer
  // connected to us before our lookup found them.
  if (peerInfo.topics.length === 0) {
    for (const [topicHex, disc] of discoveries) {
      const topic = disc.topic
      addToTopic(topicHex, topic)
    }
  }

  conn.on('close', () => {
    const peerId = conn.remotePublicKey?.toString('hex')
    log.info({
      event: 'peer-disconnected',
      peerId
    })
    for (const [topicHex, repoKey] of trackedTopics) {
      peersByTopic.get(topicHex)?.delete(conn)
      if (manager) {
        manager.emit('peer-left', {
          event: 'peer-left',
          repoKey,
          peerId,
          time: Date.now()
        })
      }
    }
  })
}

export async function createSwarm (corestore, opts = {}) {
  const bootstrap = opts.bootstrap ?? parseBootstrapEnv()

  const relayOff = process.env.PEAR_GIT_RELAY === 'off' || process.env.PEAR_GIT_RELAY === 'none'
  let dht = null
  if (!bootstrap && !opts.bootstrap && !relayOff) {
    try {
      dht = await createRelayDHT()
      log.info({ relay: process.env.PEAR_GIT_RELAY || DEFAULT_RELAY }, 'using relay DHT')
    } catch (err) {
      log.warn({ err: err.message }, 'relay DHT failed, falling back to direct')
    }
  }

  const swarmOpts = dht ? { dht, relayThrough: () => RELAY_KEY } : (bootstrap ? { bootstrap } : {})
  const swarm = new Hyperswarm(swarmOpts)
  const discoveries = new Map()
  const peersByTopic = new Map()
  const inProcessPeerRegistrations = new Map() // topicHex -> registration handle
  const localSockets = new Map() // topicHex -> { server, sockPath }
  const connectTimeout = Number(process.env.PEAR_GIT_CONNECT_TIMEOUT ?? 10000)

  const manager = new (class SwarmManager extends EventEmitter {})()

  swarm.on('connection', (conn, peerInfo) => {
    trackConnection(peersByTopic, discoveries, conn, peerInfo, corestore, manager)
  })

  function topicHexFromKey (repoKey) {
    return createHash('sha256').update(repoKey).digest().toString('hex')
  }

  async function join (repoKey) {
    const topicHex = topicHexFromKey(repoKey)
    if (discoveries.has(topicHex)) return
    const topic = Buffer.from(topicHex, 'hex')
    const discovery = swarm.join(topic, { server: true, client: true })
    discoveries.set(topicHex, discovery)

    const registration = { corestore, manager, topic }
    registerInProcessPeer(topicHex, topic, registration)
    inProcessPeerRegistrations.set(topicHex, registration)

    // Advertise a local replication socket for this repo so subprocesses can
    // piggyback on this process's corestore without rejoining the DHT.
    const sockInfo = await startLocalReplicationServer(corestore, repoKey)
    localSockets.set(topicHex, sockInfo)

    await discovery.flushed()
    setTimeout(() => {
      if (connectedPeers(repoKey) === 0) {
        log.warn({ repoKey: bs58.encode(repoKey) }, 'no peers found after connect timeout')
      }
    }, connectTimeout)
  }

  async function leave (repoKey) {
    const topicHex = topicHexFromKey(repoKey)
    const discovery = discoveries.get(topicHex)
    if (!discovery) return
    discoveries.delete(topicHex)
    const registration = inProcessPeerRegistrations.get(topicHex)
    if (registration) {
      unregisterInProcessPeer(topicHex, registration)
      inProcessPeerRegistrations.delete(topicHex)
    }
    const sockInfo = localSockets.get(topicHex)
    if (sockInfo) {
      await closeLocalSocket(sockInfo)
      localSockets.delete(topicHex)
    }
    await discovery.destroy()
    peersByTopic.delete(topicHex) // clear after destroy completes
  }

  function connectedPeers (repoKey) {
    return peersByTopic.get(topicHexFromKey(repoKey))?.size ?? 0
  }

  async function destroy () {
    for (const [topicHex, reg] of inProcessPeerRegistrations) {
      unregisterInProcessPeer(topicHex, reg)
    }
    inProcessPeerRegistrations.clear()
    for (const [topicHex, sockInfo] of localSockets) {
      await closeLocalSocket(sockInfo)
    }
    localSockets.clear()
    await swarm.destroy()
  }

  corestore.on('core', (core) => {
    core.on('download', (index, data) => {
      manager.emit('blocks-synced', {
        event: 'blocks-synced',
        repoKey: 'unknown',
        count: 1,
        time: Date.now()
      })
    })
  })

  return Object.assign(manager, { join, leave, connectedPeers, destroy })
}

async function closeLocalSocket ({ server, sockPath }) {
  try {
    await new Promise(resolve => server.close(resolve))
  } catch {
    // already closed
  }
  try { unlinkSync(sockPath) } catch { /* already removed */ }
}

/**
 * Connects `corestore` to an existing replication socket advertised by
 * another process (or by a swarm created in a parent module). Returns a
 * cleanup function that tears down the stream on exit.
 *
 * @param {object} corestore
 * @param {string} sockPath
 * @returns {Promise<() => void>}
 */
export function connectToSocket (corestore, sockPath) {
  return new Promise((resolve, reject) => {
    const socket = connect(sockPath)
    const replicationStream = corestore.replicate(true, { keepAlive: false })
    replicationStream.on('error', () => {})
    socket.once('error', (err) => {
      reject(err)
    })
    socket.on('connect', () => {
      socket.removeAllListeners('error')
      socket.on('error', () => {})
      socket.pipe(replicationStream).pipe(socket)
      resolve(() => {
        try { socket.destroy() } catch { /* already destroyed */ }
        try { replicationStream.destroy() } catch { /* already destroyed */ }
      })
    })
  })
}
