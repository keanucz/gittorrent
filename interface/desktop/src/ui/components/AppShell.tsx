import { useEffect, useMemo, useState } from 'react'
import { RepositoryDetailRoute } from '../routes/RepositoryDetail'
import { SecretsRoute } from '../routes/Secrets'
import { SeedRoute } from '../routes/Seed'
import { SettingsRoute } from '../routes/Settings'
import { WritersRoute } from '../routes/Writers'
import '../theme/tokens.css'
import { WelcomeScreen } from './WelcomeScreen'

const WORKSPACE_ROUTES = ['Overview', 'Writers', 'Secrets', 'Seed', 'Settings'] as const
type WorkspaceRoute = (typeof WORKSPACE_ROUTES)[number]

/**
 * Root of the desktop app.
 *
 * - No repo selected → JetBrains-style Welcome screen (Recent projects +
 *   New / Open / Clone CTAs).
 * - Repo selected → workspace layout with a sidebar of per-repo views and
 *   a prominent "← Projects" link to return to the welcome screen.
 */
export function AppShell () {
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(() => {
    // Persist the last-opened repo across app launches via localStorage so
    // reopening the app drops the user back where they were.
    try {
      return window.localStorage.getItem('gittorrent:lastRepo')
    } catch {
      return null
    }
  })
  const [activeRoute, setActiveRoute] = useState<WorkspaceRoute>('Overview')

  useEffect(() => {
    try {
      if (selectedRepoPath) {
        window.localStorage.setItem('gittorrent:lastRepo', selectedRepoPath)
      } else {
        window.localStorage.removeItem('gittorrent:lastRepo')
      }
    } catch { /* localStorage unavailable */ }
  }, [selectedRepoPath])

  const content = useMemo(() => {
    if (!selectedRepoPath) return null
    switch (activeRoute) {
      case 'Overview': return <RepositoryDetailRoute selectedPath={selectedRepoPath} />
      case 'Writers': return <WritersRoute selectedPath={selectedRepoPath} />
      case 'Secrets': return <SecretsRoute selectedPath={selectedRepoPath} />
      case 'Seed': return <SeedRoute selectedPath={selectedRepoPath} />
      case 'Settings': return <SettingsRoute />
      default: return <RepositoryDetailRoute selectedPath={selectedRepoPath} />
    }
  }, [activeRoute, selectedRepoPath])

  if (!selectedRepoPath) {
    return (
      <main className='app-shell app-shell--welcome' aria-label='Welcome screen'>
        <WelcomeScreen
          onOpenRepo={(path) => {
            setSelectedRepoPath(path)
            setActiveRoute('Overview')
          }}
        />
      </main>
    )
  }

  return (
    <main className='app-shell' aria-label='Workspace shell'>
      <nav className='sidebar sidebar__nav-root' aria-label='Primary navigation'>
        <button
          type='button'
          className='sidebar__back'
          onClick={() => setSelectedRepoPath(null)}
          title='Back to recent projects'
        >
          ← Projects
        </button>
        <h1 className='sidebar__title'>{basename(selectedRepoPath)}</h1>
        <p className='sidebar__path' title={selectedRepoPath}>{selectedRepoPath}</p>
        <div className='sidebar__nav'>
          {WORKSPACE_ROUTES.map((route) => (
            <button
              key={route}
              type='button'
              className='sidebar__link'
              aria-current={activeRoute === route ? 'page' : undefined}
              onClick={() => setActiveRoute(route)}
            >
              {route}
            </button>
          ))}
        </div>
      </nav>
      <section className='content' aria-live='polite'>
        {content}
      </section>
    </main>
  )
}

function basename (p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}
