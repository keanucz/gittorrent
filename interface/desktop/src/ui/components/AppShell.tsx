import { useMemo, useState } from 'react'
import { RepositoriesRoute } from '../routes/Repositories'
import { RepositoryDetailRoute } from '../routes/RepositoryDetail'
import { SecretsRoute } from '../routes/Secrets'
import { SeedRoute } from '../routes/Seed'
import { SettingsRoute } from '../routes/Settings'
import { WritersRoute } from '../routes/Writers'
import '../theme/tokens.css'
import { ROUTE_ITEMS, Sidebar } from './Sidebar'

const routes = ROUTE_ITEMS

type RouteName = (typeof routes)[number]

export function AppShell () {
  const [activeRoute, setActiveRoute] = useState<RouteName>('Repositories')
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null)

  const content = useMemo(() => {
    switch (activeRoute) {
      case 'Repositories':
        return <RepositoriesRoute selectedPath={selectedRepoPath} onSelectRepo={setSelectedRepoPath} />
      case 'Repo Detail':
        return <RepositoryDetailRoute selectedPath={selectedRepoPath} />
      case 'Writers':
        return <WritersRoute selectedPath={selectedRepoPath} />
      case 'Secrets':
        return <SecretsRoute selectedPath={selectedRepoPath} />
      case 'Seed':
        return <SeedRoute selectedPath={selectedRepoPath} />
      case 'Settings':
        return <SettingsRoute />
      default:
        return <RepositoriesRoute selectedPath={selectedRepoPath} onSelectRepo={setSelectedRepoPath} />
    }
  }, [activeRoute, selectedRepoPath])

  return (
    <main className='app-shell' aria-label='Desktop app shell'>
      <Sidebar activeRoute={activeRoute} routes={routes} onSelect={(route) => setActiveRoute(route as RouteName)} />
      <section className='content' aria-live='polite'>
        {content}
      </section>
    </main>
  )
}
