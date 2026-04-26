type SidebarProps = {
  activeRoute: string
  routes: readonly string[]
  onSelect: (route: string) => void
}

export const ROUTE_ITEMS = [
  'Repositories',
  'Repo Detail',
  'Writers',
  'Secrets',
  'Seed',
  'Settings'
] as const

export function Sidebar ({ activeRoute, routes, onSelect }: SidebarProps) {
  return (
    <nav className='sidebar sidebar__nav-root' aria-label='Primary navigation'>
      <h1 className='sidebar__title'>gittorrent desktop</h1>
      <div className='sidebar__nav'>
        {routes.map((route) => (
          <button
            key={route}
            type='button'
            className='sidebar__link'
            aria-current={activeRoute === route ? 'page' : undefined}
            onClick={() => onSelect(route)}
          >
            {route}
          </button>
        ))}
      </div>
    </nav>
  )
}
