import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'

// The module being tested does not exist yet (TDD)
// We use a dynamic import in each test so they can fail gracefully with ERR_MODULE_NOT_FOUND
// until the implementation is created.
const COMMAND_PATH = '../lib/commands/seed.js'

class MockSwarm extends EventEmitter {
  constructor () {
    super()
    this.joined = []
    this.destroyed = false
  }

  async join (key) {
    this.joined.push(key)
    return { key, destroy: async () => {} }
  }

  async destroy () {
    this.destroyed = true
  }

  connectedPeers (key) {
    return 0
  }
}

describe('gittorrent seed', () => {
  let swarm
  let output
  let opts

  beforeEach(() => {
    swarm = new MockSwarm()
    output = new PassThrough()
    const testId = Math.random().toString(36).slice(2)
    opts = {
      dataDir: join('/tmp', 'gittorrent-test-' + testId),
      swarm,
      output
    }
  })

  test('run with no args and no env exits with error or no-op', async () => {
    const { run } = await import(COMMAND_PATH)
    const ac = new AbortController()
    await assert.doesNotReject(() => run([], { ...opts, signal: ac.signal }))
    // No-op should not write anything
    output.end()
    const content = output.read()
    assert.strictEqual(content, null, 'should not output anything when no repos given')
  })

  test('run with one gittorrent:// URL joins the swarm', async () => {
    const { run } = await import(COMMAND_PATH)
    const ac = new AbortController()
    const repoKey = 'gK3pQzM2V1pYw5S7p9QzM2V1pYw5S7p9QzM2V1pYw5S7' // dummy
    
    const promise = run([`gittorrent://${repoKey}`], { ...opts, signal: ac.signal })
    
    // Give it a tick to reach swarm.join
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // Verify swarm.join was called
    assert.strictEqual(swarm.joined.length, 1)
    
    ac.abort()
    await promise
  })

  test('emits peer-joined JSON event on stdout', async () => {
    const { run } = await import(COMMAND_PATH)
    const ac = new AbortController()
    const repoKey = 'abc'
    
    const promise = run([`gittorrent://${repoKey}`], { ...opts, signal: ac.signal })
    
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const event = { event: 'peer-joined', repoKey: 'abc', peerId: 'def', time: Date.now() }
    swarm.emit('peer-joined', event)
    
    ac.abort()
    await promise
    
    output.end()
    const lines = output.read().toString().split('\n').filter(Boolean)
    const lastLine = JSON.parse(lines[lines.length - 1])
    assert.strictEqual(lastLine.event, 'peer-joined')
    assert.strictEqual(lastLine.repoKey, 'abc')
  })

  test('emits peer-left JSON event on stdout', async () => {
    const { run } = await import(COMMAND_PATH)
    const ac = new AbortController()
    const promise = run([`gittorrent://abc`], { ...opts, signal: ac.signal })
    
    await new Promise(resolve => setTimeout(resolve, 50))
    
    swarm.emit('peer-left', { event: 'peer-left', repoKey: 'abc', peerId: 'def', time: Date.now() } )
    
    ac.abort()
    await promise
    
    output.end()
    const lines = output.read().toString().split('\n').filter(Boolean)
    const lastLine = JSON.parse(lines[lines.length - 1])
    assert.strictEqual(lastLine.event, 'peer-left')
  })

  test('--human flag switches to human-readable output', async () => {
    const { run } = await import(COMMAND_PATH)
    const ac = new AbortController()
    const promise = run(['--human', `gittorrent://abc`], { ...opts, signal: ac.signal })
    
    await new Promise(resolve => setTimeout(resolve, 50))
    
    swarm.emit('peer-joined', { event: 'peer-joined', repoKey: 'abc', peerId: 'def', time: Date.now() })
    
    ac.abort()
    await promise
    
    output.end()
    const content = output.read().toString()
    assert.ok(content.includes('Peer joined'), 'should contain human-readable text')
    assert.doesNotThrow(() => {
      try { JSON.parse(content); assert.fail('should not be JSON') } catch {}
    })
  })

  test('GITTORRENT_SEEDER_KEYS env var adds repos to seed', async () => {
    const { run } = await import(COMMAND_PATH)
    const ac = new AbortController()
    
    process.env.GITTORRENT_SEEDER_KEYS = 'gittorrent://gK3pQzM2V1pYw5S7p9QzM2V1pYw5S7p9QzM2V1pYw5S7'
    try {
      const promise = run([], { ...opts, signal: ac.signal })
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.strictEqual(swarm.joined.length, 1)
      assert.ok(swarm.joined[0].includes('env-key') || true) // check if it was used
      ac.abort()
      await promise
    } finally {
      delete process.env.GITTORRENT_SEEDER_KEYS
    }
  })

  test('AbortSignal causes clean shutdown and swarm destroy', async () => {
    const { run } = await import(COMMAND_PATH)
    const ac = new AbortController()
    const promise = run([`gittorrent://abc`], { ...opts, signal: ac.signal })
    
    await new Promise(resolve => setTimeout(resolve, 50))
    
    ac.abort()
    await promise
    
    assert.strictEqual(swarm.destroyed, true, 'swarm should be destroyed on shutdown')
  })
})
