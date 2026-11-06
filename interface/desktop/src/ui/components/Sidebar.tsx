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
      <div className='sidebar__brand' style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 16px 8px' }}>
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <path d="M9 7V25M9 16C12 16 15 13 18 13H23" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M19 8C21.5 9.5 23 11 23 13C23 15 21.5 16.5 19 18" stroke="#F43F5E" strokeWidth="2.25" strokeLinecap="round" fill="none"/>
          <path d="M22 5C25.5 7 27 10 27 13C27 16 25.5 19 22 21" stroke="#F43F5E" strokeWidth="2.25" strokeLinecap="round" fill="none" opacity="0.6"/>
          <circle cx="9" cy="7" r="2.25" fill="#38BDF8"/>
          <circle cx="9" cy="25" r="2.25" fill="#38BDF8"/>
          <circle cx="23" cy="13" r="2.25" fill="#F43F5E"/>
        </svg>
        <h1 className='sidebar__title' style={{ margin: 0, fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.025em' }}>gittorrent</h1>
      </div>
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
