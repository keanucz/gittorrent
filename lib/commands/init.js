import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import bs58 from 'bs58'
import Corestore from 'corestore'
import pino from 'pino'
import { loadIdentity } from '../identity.js'
import { openRepo } from '../autobase-repo.js'

// Promisified execFile — always invoked with an argv array so user-controlled
// values can never be interpreted by a shell.
const execFileAsync = promisify(execFile)

const rootLogger = pino(
  {
    level: process.env.PEAR_GIT_LOG_LEVEL || 'info',
    redact: ['identity.secretKey', 'secretKey', '*.secretKey', '[*].secretKey'],
    base: { pid: process.pid }
  },
  pino.destination({ fd: 2 })
)

const log = rootLogger.child({ component: 'cli' })

const GITIGNORE_PATTERNS = ['.env', '.env.*', '*.pem', '*.key', 'secrets/']
const PROGRESS_MESSAGE = 'Repo created. Share this URL with collaborators.\n'

/**
 * Initialize a new pear-git repo in `cwd`, storing Autobase data under `dataDir`.
 *
 * @param {{ cwd: string, dataDir: string, name?: string }} opts
 * @returns {Promise<{ url: string }>}
 */
export async function initRepo ({ cwd, dataDir, name }) {
  void name // accepted but currently unused (future alias support)

  await ensureGitRepo(cwd)
  await ensureNotAlreadyInitialised(cwd)

  const identity = await loadIdentity(dataDir)

  const { key, finalStorePath } = await createRepoStore(dataDir, identity)
  const url = 'pear://' + bs58.encode(Buffer.from(key))

  await setGitOrigin(cwd, url)
  await updateGitignore(cwd)

  process.stderr.write(PROGRESS_MESSAGE)
  log.info({ repoKey: bs58.encode(Buffer.from(key)), storePath: finalStorePath }, 'repo initialised')

  return { url }
}

/**
 * CLI entry used by `bin/pear-git init`. Resolves defaults from env, prints
 * the URL to stdout, writes progress to stderr, exits non-zero on failure.
 *
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export async function run (args) {
  const { name } = parseArgs(args)
  const cwd = process.cwd()
  const dataDir = process.env.PEAR_GIT_DATA_DIR || join(homedir(), '.pear-git')

  try {
    const { url } = await initRepo({ cwd, dataDir, name })
    process.stdout.write(url + '\n')
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    process.stderr.write('pear-git: error: ' + message + '\n')
    process.exit(1)
  }
}

function parseArgs (args) {
  const result = { name: undefined }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && i + 1 < args.length) {
      result.name = args[i + 1]
      i++
    }
  }
  return result
}

async function ensureGitRepo (cwd) {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd })
  } catch {
    throw new Error(`not a git repository: ${cwd}`)
  }
}

async function ensureNotAlreadyInitialised (cwd) {
  let existing
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd })
    existing = stdout.trim()
  } catch {
    return // no origin set — proceed
  }
  if (existing && existing.startsWith('pear://')) {
    throw new Error(`already a pear-git repo (origin is ${existing})`)
  }
}

async function createRepoStore (dataDir, identity) {
  const storesDir = join(dataDir, 'stores')
  await mkdir(storesDir, { recursive: true })

  const tmpName = '_init_tmp_' + randomBytes(8).toString('hex')
  const tmpStorePath = join(storesDir, tmpName)

  const tmpStore = new Corestore(tmpStorePath)
  await tmpStore.ready()

  const tmpRepo = await openRepo(tmpStore, identity)
  const key = Buffer.from(tmpRepo.key)

  await tmpRepo.close()
  await tmpStore.close()

  const finalStorePath = join(storesDir, bs58.encode(key))
  await rename(tmpStorePath, finalStorePath)

  return { key, finalStorePath }
}

async function setGitOrigin (cwd, url) {
  await execFileAsync('git', ['remote', 'add', 'origin', url], { cwd })
}

async function updateGitignore (cwd) {
  const gitignorePath = join(cwd, '.gitignore')
  const existing = await readFileIfExists(gitignorePath)

  if (existing === null) {
    const content = GITIGNORE_PATTERNS.join('\n') + '\n'
    await writeFile(gitignorePath, content, 'utf-8')
    return
  }

  const missing = GITIGNORE_PATTERNS.filter(pattern => !hasPattern(existing, pattern))
  if (missing.length === 0) return

  const separator = existing.endsWith('\n') ? '' : '\n'
  const appended = existing + separator + missing.join('\n') + '\n'
  await writeFile(gitignorePath, appended, 'utf-8')
}

async function readFileIfExists (filePath) {
  try {
    await stat(filePath)
  } catch {
    return null
  }
  return readFile(filePath, 'utf-8')
}

function hasPattern (content, pattern) {
  const lines = content.split(/\r?\n/)
  return lines.some(line => line.trim() === pattern)
}
