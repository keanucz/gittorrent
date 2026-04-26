import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { repoClone, repoInit, repoList, repoRemove, repoTouch } from '../services/tauri-api'
import type { RepoSummary } from '../types/ipc'

type WelcomeScreenProps = {
  onOpenRepo: (path: string) => void
}

type Panel = 'recents' | 'learn'

type Busy = null | { kind: 'clone' | 'init' | 'open'; label: string }

/**
 * JetBrains-style welcome screen. Left sidebar = panel switcher, right side
 * shows the recent-projects list with a search box + big call-to-action
 * buttons. Empty state collapses the list and foregrounds the CTAs.
 */
export function WelcomeScreen ({ onOpenRepo }: WelcomeScreenProps) {
  const [repos, setRepos] = useState<RepoSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('recents')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  async function refresh () {
    setLoading(true)
    setError(null)
    try {
      const data = await repoList()
      setRepos(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repositories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(r =>
      (r.name ?? '').toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q) ||
      (r.url ?? '').toLowerCase().includes(q)
    )
  }, [repos, search])

  async function handleOpenRepo (path: string) {
    setBusy({ kind: 'open', label: `Opening ${path}` })
    try {
      await repoTouch(path)
      onOpenRepo(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open repo')
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove (path: string) {
    setMenuFor(null)
    try {
      await repoRemove(path)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from recents')
    }
  }

  async function pickDirectory (purpose: 'init' | 'clone' | 'open'): Promise<string | null> {
    const title =
      purpose === 'init' ? 'Choose a directory for the new repository' :
      purpose === 'clone' ? 'Choose where to clone this repository' :
      'Choose an existing repository directory'
    const picked = await open({ directory: true, multiple: false, title })
    if (typeof picked !== 'string' || !picked.trim()) return null
    return picked
  }

  async function handleInit () {
    try {
      const dir = await pickDirectory('init')
      if (!dir) return
      setBusy({ kind: 'init', label: `Initialising ${dir}` })
      const created = await repoInit({ path: dir })
      await refresh()
      onOpenRepo(created.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialise repo')
    } finally {
      setBusy(null)
    }
  }

  async function handleOpenExisting () {
    try {
      const dir = await pickDirectory('open')
      if (!dir) return
      setBusy({ kind: 'open', label: `Opening ${dir}` })
      await repoTouch(dir)
      await refresh()
      onOpenRepo(dir)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open repo')
    } finally {
      setBusy(null)
    }
  }

  async function handleCloneFromUrl () {
    try {
      const url = window.prompt('Paste the gittorrent:// URL to clone:')
      if (!url || !url.trim()) return
      const dir = await pickDirectory('clone')
      if (!dir) return
      setBusy({ kind: 'clone', label: `Cloning ${url.trim()}` })
      const created = await repoClone({ url: url.trim(), path: dir })
      await refresh()
      onOpenRepo(created.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone repo')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className='welcome-root' onClick={() => setMenuFor(null)}>
      <aside className='welcome-sidebar'>
        <h1 className='welcome-sidebar__title'>gittorrent</h1>
        <p className='welcome-sidebar__subtitle'>Decentralised git</p>
        <nav className='welcome-sidebar__nav'>
          <button
            type='button'
            className={`welcome-sidebar__link ${panel === 'recents' ? 'is-active' : ''}`}
            onClick={() => setPanel('recents')}
          >
            Projects
          </button>
          <button
            type='button'
            className={`welcome-sidebar__link ${panel === 'learn' ? 'is-active' : ''}`}
            onClick={() => setPanel('learn')}
          >
            Learn
          </button>
        </nav>
      </aside>

      <main className='welcome-main'>
        {panel === 'recents' && (
          <>
            <header className='welcome-header'>
              <div className='welcome-header__search'>
                <input
                  type='search'
                  className='welcome-search'
                  placeholder='Search projects'
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label='Search projects'
                />
              </div>
              <div className='welcome-header__actions'>
                <button type='button' className='welcome-btn welcome-btn--primary' onClick={() => void handleInit()}>
                  New Project
                </button>
                <button type='button' className='welcome-btn' onClick={() => void handleOpenExisting()}>
                  Open
                </button>
                <button type='button' className='welcome-btn' onClick={() => void handleCloneFromUrl()}>
                  Get from URL
                </button>
              </div>
            </header>

            {busy && <p className='welcome-status welcome-status--busy'>{busy.label}…</p>}
            {error && <p className='welcome-status welcome-status--error'>{error}</p>}

            {loading && <p className='welcome-status'>Loading projects…</p>}
            {!loading && repos.length === 0 && (
              <EmptyState
                onInit={() => void handleInit()}
                onOpen={() => void handleOpenExisting()}
                onClone={() => void handleCloneFromUrl()}
              />
            )}

            {!loading && repos.length > 0 && filtered.length === 0 && (
              <p className='welcome-status'>No projects match &ldquo;{search}&rdquo;.</p>
            )}

            {!loading && filtered.length > 0 && (
              <ul className='welcome-list' aria-label='Recent projects'>
                {filtered.map((repo) => (
                  <li key={repo.path} className='welcome-list__item'>
                    <button
                      type='button'
                      className='welcome-row'
                      onClick={() => void handleOpenRepo(repo.path)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenuFor(menuFor === repo.path ? null : repo.path)
                      }}
                    >
                      <div className='welcome-row__icon' aria-hidden>
                        {(repo.name ?? repo.path).slice(0, 2).toUpperCase()}
                      </div>
                      <div className='welcome-row__text'>
                        <div className='welcome-row__name'>{repo.name ?? basename(repo.path)}</div>
                        <div className='welcome-row__path'>{repo.path}</div>
                        {repo.url && <div className='welcome-row__url'>{repo.url}</div>}
                      </div>
                      <div className='welcome-row__meta'>{formatRecency(repo.lastOpened)}</div>
                    </button>
                    {menuFor === repo.path && (
                      <div
                        className='welcome-row__menu'
                        role='menu'
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button type='button' role='menuitem' onClick={() => void handleRemove(repo.path)}>
                          Remove from Recent Projects
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {panel === 'learn' && (
          <div className='welcome-learn'>
            <h2>Quick reference</h2>
            <ul>
              <li><strong>New Project</strong> — bootstraps a git repo and runs <code>gittorrent init</code>.</li>
              <li><strong>Open</strong> — select a directory that already has a <code>gittorrent://</code> origin.</li>
              <li><strong>Get from URL</strong> — paste a <code>gittorrent://&lt;base58&gt;</code> URL to clone.</li>
              <li>Right-click a project to remove it from the Recent list (doesn&rsquo;t delete files).</li>
            </ul>
            <h2>Under the hood</h2>
            <p>
              Each repo syncs over an Autobase replicated via Hyperswarm. Writes go through a background
              seeder daemon so any open terminal can push without lock conflicts.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

function EmptyState ({ onInit, onOpen, onClone }: { onInit: () => void; onOpen: () => void; onClone: () => void }) {
  return (
    <div className='welcome-empty'>
      <h2>Welcome</h2>
      <p>Create, open, or clone a repository to get started.</p>
      <div className='welcome-empty__actions'>
        <button type='button' className='welcome-btn welcome-btn--primary' onClick={onInit}>New Project</button>
        <button type='button' className='welcome-btn' onClick={onOpen}>Open Existing</button>
        <button type='button' className='welcome-btn' onClick={onClone}>Clone from URL</button>
      </div>
    </div>
  )
}

function basename (p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function formatRecency (ts: number | undefined): string {
  if (!ts || ts === 0) return 'never opened'
  const secs = Math.max(1, Math.floor(Date.now() / 1000 - ts))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const date = new Date(ts * 1000)
  return date.toLocaleDateString()
}
