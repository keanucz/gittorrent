import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSwarm } from '../lib/swarm.js'
import Corestore from 'corestore'
import HyperDHT from 'hyperdht'

// ─── helpers ──────────────────────────────────────────────────────────────────

function withTimeout (promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ])
}

async function makeStore () {
  const dir = await mkdtemp(join(tmpdir(), 'gittorrent-swarm-test-'))
  const store = new Corestore(dir)
  await store.ready()
  store._testDir = dir
  return store
}

async function closeStore (store) {
  await store.close()
  await rm(store._testDir, { recursive: true, force: true })
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

describe('swarm.js', () => {
  let managers
  let stores
  let bootstrapNodes

  beforeEach(() => {
    managers = []
    stores = []
    bootstrapNodes = []
  })

  afterEach(async () => {
    // Destroy all SwarmManagers before closing their stores.
    await Promise.all(managers.map(m => m.destroy().catch(() => {})))
    await Promise.all(stores.map(s => closeStore(s).catch(() => {})))
    await Promise.all(bootstrapNodes.map(n => n.destroy().catch(() => {})))
  })

  async function newStore () {
    const s = await makeStore()
    stores.push(s)
    return s
  }

  async function newManager (store, opts) {
    const m = await createSwarm(store, opts)
    managers.push(m)
    return m
  }

  async function localBootstrap () {
    // HyperDHT with bootstrap:false acts as a standalone routing node that
    // allows two in-process Hyperswarm instances to discover each other without
    // touching the public DHT.
    const node = new HyperDHT({ bootstrap: false })
    await node.ready()
    bootstrapNodes.push(node)
    return [{ host: '127.0.0.1', port: node.address().port }]
  }

  // ─── interface shape ───────────────────────────────────────────────────────

  test('createSwarm resolves to a SwarmManager without error', async () => {
    const manager = await newManager(await newStore())
    assert.ok(manager, 'should return a truthy value')
    assert.equal(typeof manager.join, 'function', 'must expose join()')
    assert.equal(typeof manager.leave, 'function', 'must expose leave()')
    assert.equal(typeof manager.connectedPeers, 'function', 'must expose connectedPeers()')
    assert.equal(typeof manager.destroy, 'function', 'must expose destroy()')
  })

  // ─── connectedPeers baseline ───────────────────────────────────────────────

  test('connectedPeers returns 0 before any join', async () => {
    const manager = await newManager(await newStore())
    const repoKey = randomBytes(32)
    assert.equal(manager.connectedPeers(repoKey), 0)
  })

  // ─── join ──────────────────────────────────────────────────────────────────

  test('join does not throw', async () => {
    const manager = await newManager(await newStore())
    const repoKey = randomBytes(32)
    await assert.doesNotReject(() => manager.join(repoKey))
  })

  // ─── leave ─────────────────────────────────────────────────────────────────

  test('leave on an un-joined key does not throw', async () => {
    const manager = await newManager(await newStore())
    const repoKey = randomBytes(32)
    await assert.doesNotReject(() => manager.leave(repoKey))
  })

  // ─── destroy ───────────────────────────────────────────────────────────────

  test('destroy closes the swarm cleanly with no unhandled rejection', async () => {
    // Create and destroy without going through afterEach so we test the
    // teardown path in isolation.
    const store = await makeStore()
    const manager = await createSwarm(store)
    await assert.doesNotReject(() => manager.destroy())
    await closeStore(store)
  })

  // ─── two-peer connectivity ─────────────────────────────────────────────────
  //
  // We spin up a local HyperDHT node (bootstrap: false) so two in-process
  // SwarmManagers can discover each other without contacting the public DHT.
  // The opts.bootstrap array is forwarded to the Hyperswarm constructor inside
  // swarm.js.
  //
  // If future refactoring makes this incompatible with the unit-test context,
  // promote these to test/e2e/clone-push-pull.test.js (Task 27) and replace
  // them here with a lighter assertion that join() announces the correct topic
  // (e.g. inspect swarm.topics or a swarm.joined() accessor).

  test('two managers on the same topic discover and connect to each other', async () => {
    const bootstrap = await localBootstrap()

    const repoKey = randomBytes(32)
    const m1 = await newManager(await newStore(), { bootstrap })
    const m2 = await newManager(await newStore(), { bootstrap })

    await m1.join(repoKey)
    await m2.join(repoKey)

    await withTimeout(
      new Promise(resolve => {
        const iv = setInterval(() => {
          if (m1.connectedPeers(repoKey) >= 1 && m2.connectedPeers(repoKey) >= 1) {
            clearInterval(iv)
            resolve()
          }
        }, 100)
      }),
      5000,
      'peers did not connect within 5 s'
    )

    assert.equal(m1.connectedPeers(repoKey), 1)
    assert.equal(m2.connectedPeers(repoKey), 1)
  })

  test('connectedPeers returns 0 after leave', async () => {
    const bootstrap = await localBootstrap()

    const repoKey = randomBytes(32)
    const m1 = await newManager(await newStore(), { bootstrap })
    const m2 = await newManager(await newStore(), { bootstrap })

    await m1.join(repoKey)
    await m2.join(repoKey)

    // Wait until both sides are connected.
    await withTimeout(
      new Promise(resolve => {
        const iv = setInterval(() => {
          if (m1.connectedPeers(repoKey) >= 1 && m2.connectedPeers(repoKey) >= 1) {
            clearInterval(iv)
            resolve()
          }
        }, 100)
      }),
      5000,
      'peers did not connect before leave test'
    )

    await m1.leave(repoKey)

    assert.equal(m1.connectedPeers(repoKey), 0)
  })
})
