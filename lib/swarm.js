import { createHash } from 'node:crypto'
import Hyperswarm from 'hyperswarm'
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

function parseBootstrapEnv () {
  const bootstrapEnv = process.env.PEAR_GIT_BOOTSTRAP_NODES
  if (!bootstrapEnv) return undefined
  return bootstrapEnv.split(',').map(s => {
    const [host, port] = s.trim().split(':')
    return { host, port: Number(port) }
  })
}

function addConnToTopic (peersByTopic, conn, topicHex) {
  if (!peersByTopic.has(topicHex)) peersByTopic.set(topicHex, new Set())
  peersByTopic.get(topicHex).add(conn)
}

function trackConnection (peersByTopic, discoveries, conn, peerInfo, corestore) {
  corestore.replicate(conn)

  const trackedTopics = new Set()

  function addToTopic (topicHex, topic) {
    if (trackedTopics.has(topicHex)) return
    trackedTopics.add(topicHex)
    addConnToTopic(peersByTopic, conn, topicHex)
    log.info({
      event: 'peer-connected',
      repoKey: bs58.encode(topic),
      peerId: conn.remotePublicKey?.toString('hex')
    })
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
      peerId: conn.remotePublicKey?.toString('hex')
    })
    for (const topicHex of trackedTopics) {
      peersByTopic.get(topicHex)?.delete(conn)
    }
  })
}

export async function createSwarm (corestore, opts = {}) {
  const bootstrap = opts.bootstrap ?? parseBootstrapEnv()
  const swarm = new Hyperswarm({ bootstrap })
  const discoveries = new Map()
  const peersByTopic = new Map()
  const connectTimeout = Number(process.env.PEAR_GIT_CONNECT_TIMEOUT ?? 10000)

  swarm.on('connection', (conn, peerInfo) => {
    trackConnection(peersByTopic, discoveries, conn, peerInfo, corestore)
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
    await discovery.destroy()
    peersByTopic.delete(topicHex)  // clear after destroy completes
  }

  function connectedPeers (repoKey) {
    return peersByTopic.get(topicHexFromKey(repoKey))?.size ?? 0
  }

  async function destroy () {
    await swarm.destroy()
  }

  return { join, leave, connectedPeers, destroy }
}
