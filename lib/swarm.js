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

// Map topic-hex -> base58(repoKey) so log lines show the caller-facing repo
// identifier instead of the internal sha256 topic. This fixes a long-standing
// diagnostic confusion where connection logs showed `AqzS37Fe...` (topic hash
// base58-encoded) instead of the user's actual `BxXpqJTg...` repoKey.
const topicToRepoKey = new Map()

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
  const repoKey = topicToRepoKey.get(topic.toString('hex')) ?? bs58.encode(topic)
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

  log.info({ url: relayUrl }, 'WebSocket relay connection established')

  // Wire socket-level byte counters so we can diagnose stuck replication.
  // Without these, "peer connected but no data transfer" is a black box:
  // this tells us whether the relay is actually pumping bytes.
  let rxBytes = 0
  let txBytes = 0
  const origSend = ws.send.bind(ws)
  ws.send = function (data, ...rest) {
    if (typeof data === 'string') txBytes += data.length
    else if (data) txBytes += data.byteLength || data.length || 0
    return origSend(data, ...rest)
  }
  ws.on('message', (data) => {
    if (data) rxBytes += data.byteLength || data.length || 0
  })
  ws.on('close', (code, reason) => {
    log.warn({ code, reason: reason?.toString(), rxBytes, txBytes }, 'relay WebSocket closed')
  })
  ws.on('error', (err) => {
    log.warn({ err: err.message }, 'relay WebSocket error')
  })

  // Periodic traffic report — helps distinguish "connection exists but nothing
  // flowing" from "data flowing but replication stalled at application layer".
  // Keepalive heartbeats are ~8-10 bytes each direction; ignore anything
  // smaller than 64 bytes delta as noise so the log stays scannable.
  if (process.env.PEAR_GIT_RELAY_TRAFFIC !== 'off') {
    let lastRx = 0
    let lastTx = 0
    const interval = setInterval(() => {
      const dRx = rxBytes - lastRx
      const dTx = txBytes - lastTx
      if (dRx >= 64 || dTx >= 64) {
        log.debug({ rxBytes, txBytes, deltaRx: dRx, deltaTx: dTx }, 'relay traffic')
      }
      lastRx = rxBytes
      lastTx = txBytes
    }, 5000).unref()
    ws.on('close', () => clearInterval(interval))
  }

  return new RelayDHT(new Stream(true, ws))
}

function addConnToTopic (peersByTopic, conn, topicHex) {
  if (!peersByTopic.has(topicHex)) peersByTopic.set(topicHex, new Set())
  peersByTopic.get(topicHex).add(conn)
}

function resolveRepoKey (topicHex, topicBuf) {
  return topicToRepoKey.get(topicHex) ?? bs58.encode(topicBuf)
}

/**
 * Attaches diagnostic logging to a connection so we can trace exactly where
 * replication stalls.  Previously all logs stopped at `peer-connected` —
 * which only tells us the secret-stream handshake happened.  These events
 * tell us whether the corestore protomux is actually opening channels and
 * exchanging hypercore blocks.
 */
function instrumentConnection (conn, peerIdShort, repoKey, corestore) {
  const diagEnabled = process.env.PEAR_GIT_CONN_DIAG !== 'off'
  if (!diagEnabled) return

  const tag = `conn<${peerIdShort.slice(0, 8)}>`

  let bytesIn = 0
  let bytesOut = 0
  const rawStream = conn.rawStream
  if (rawStream) {
    rawStream.on('data', (chunk) => { bytesIn += chunk?.length || 0 })
    const origWrite = rawStream.write.bind(rawStream)
    rawStream.write = (...args) => {
      const chunk = args[0]
      if (chunk) bytesOut += chunk.length || chunk.byteLength || 0
      return origWrite(...args)
    }
  }

  conn.on('open', () => {
    log.info({ tag, peerId: peerIdShort, repoKey }, 'secret-stream opened')
  })

  const muxer = conn.userData
  if (muxer && typeof muxer.on === 'function') {
    muxer.on('pair', (info) => {
      log.info({ tag, protocol: info?.protocol, id: info?.id?.toString?.('hex')?.slice(0, 16) }, 'protomux channel paired')
    })
  }

  // Hypercore channel-level events — these are what actually indicate the
  // replication stream is doing something.  We hook into corestore's cores
  // to see who is asking for what.
  const attached = new WeakSet()
  const attachCore = (core) => {
    if (attached.has(core)) return
    attached.add(core)
    core.on('peer-add', (peer) => {
      if (peer.stream?.rawStream === rawStream) {
        log.info({ tag, coreKey: core.key?.toString('hex').slice(0, 16), length: core.length }, 'hypercore peer-add')
      }
    })
    core.on('peer-remove', (peer) => {
      if (peer.stream?.rawStream === rawStream) {
        log.info({ tag, coreKey: core.key?.toString('hex').slice(0, 16) }, 'hypercore peer-remove')
      }
    })
    if (process.env.PEAR_GIT_LOG_LEVEL === 'debug') {
      core.on('download', (index, byteLength) => {
        log.debug({ tag, coreKey: core.key?.toString('hex').slice(0, 16), index, byteLength }, 'hypercore download')
      })
      core.on('upload', (index, byteLength) => {
        log.debug({ tag, coreKey: core.key?.toString('hex').slice(0, 16), index, byteLength }, 'hypercore upload')
      })
    }
  }
  for (const core of corestore.cores.values()) attachCore(core)
  corestore.on('core-open', attachCore)

  // On close, emit a summary that lets us immediately tell whether the
  // connection pumped any bytes at all.
  conn.on('close', () => {
    log.info({ tag, peerId: peerIdShort, repoKey, bytesIn, bytesOut }, 'connection closed (summary)')
  })
}

function trackConnection (peersByTopic, discoveries, conn, peerInfo, corestore, manager) {
  corestore.replicate(conn)
  conn.on('error', (err) => log.debug({ err: err.message }, 'conn error'))

  const peerId = conn.remotePublicKey?.toString('hex')
  const peerIdShort = peerId?.slice(0, 16) || 'unknown'
  const trackedTopics = new Map() // topicHex -> repoKey (base58)

  function addToTopic (topicHex, topic) {
    if (trackedTopics.has(topicHex)) return
    const repoKey = resolveRepoKey(topicHex, topic)
    trackedTopics.set(topicHex, repoKey)
    addConnToTopic(peersByTopic, conn, topicHex)

    log.info({
      event: 'peer-connected',
      repoKey,
      peerId
    })

    instrumentConnection(conn, peerIdShort, repoKey, corestore)

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

  // NOTE: `relayThrough` requires HyperDHT's blind-relay machinery which uses
  // raw UDP sockets. When `dht` is a `RelayDHT` client (WebSocket-relayed),
  // those UDP code paths don't exist, so passing `relayThrough` is a no-op
  // at best and a debug hazard at worst. We only set it when using a native
  // UDP DHT (bootstrap mode).
  const swarmOpts = dht
    ? { dht }
    : (bootstrap
        ? { bootstrap, relayThrough: () => RELAY_KEY }
        : { relayThrough: () => RELAY_KEY })
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

    // Remember the caller-facing repoKey so connection logs can display it
    // instead of the internal topic hash. Without this, logs look like they
    // reference a completely different repo which misled debugging for hours.
    topicToRepoKey.set(topicHex, bs58.encode(repoKey))

    const discovery = swarm.join(topic, { server: true, client: true })
    discoveries.set(topicHex, discovery)
    log.info({ repoKey: bs58.encode(repoKey), topicHex: topicHex.slice(0, 16) }, 'joined swarm topic')

    const registration = { corestore, manager, topic }
    registerInProcessPeer(topicHex, topic, registration)
    inProcessPeerRegistrations.set(topicHex, registration)

    // Advertise a local replication socket for this repo so subprocesses can
    // piggyback on this process's corestore without rejoining the DHT.
    const sockInfo = await startLocalReplicationServer(corestore, repoKey)
    localSockets.set(topicHex, sockInfo)

    // When using the RelayDHT client, don't block on flushed(). The relay
    // proxies the announce without round-tripping an ACK back to us, so
    // `discovery.flushed()` can hang forever. Git would then never start
    // reading stdin because join() never returned. Fire and forget in
    // relay mode; peers connect once the relay indexes the announce.
    if (dht) {
      discovery.flushed()
        .then(() => log.info({ repoKey: bs58.encode(repoKey) }, 'DHT announce flushed'))
        .catch((err) => log.warn({ err: err.message }, 'DHT announce flush failed'))
    } else {
      await discovery.flushed()
      log.info({ repoKey: bs58.encode(repoKey) }, 'DHT announce flushed')
    }

    setTimeout(() => {
      const n = connectedPeers(repoKey)
      if (n === 0) {
        log.warn({ repoKey: bs58.encode(repoKey) }, 'no peers found after connect timeout')
      } else {
        log.info({ repoKey: bs58.encode(repoKey), peers: n }, 'peers connected within timeout')
      }
    }, connectTimeout)
  }

  async function leave (repoKey) {
    const topicHex = topicHexFromKey(repoKey)
    const discovery = discoveries.get(topicHex)
    if (!discovery) return
    discoveries.delete(topicHex)
    topicToRepoKey.delete(topicHex)
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
