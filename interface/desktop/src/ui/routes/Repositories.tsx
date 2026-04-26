import { CloneDialog } from '../components/CloneDialog'
import { InitDialog } from '../components/InitDialog'
import { useRepoMutations } from '../state/repo-mutations'
import { useRepoList } from '../state/repo-queries'

type RepositoriesRouteProps = {
  selectedPath: string | null
  onSelectRepo: (path: string) => void
}

export function RepositoriesRoute ({ selectedPath, onSelectRepo }: RepositoriesRouteProps) {
  const { loading, repositories, error, refresh } = useRepoList()
  const { inProgress, progressLabel, error: mutationError, cloneRepo, initRepo } = useRepoMutations(async () => {
    await refresh()
  })

  return (
    <section className='content__panel'>
      <h2 className='route-title'>Repositories</h2>
      <p className='route-copy'>Browse local repositories and current sync posture from one place.</p>
      <div className='row-actions'>
        <button type='button' className='sidebar__link' onClick={() => void refresh()}>Refresh List</button>
      </div>
      <div className='dialog-grid'>
        <CloneDialog
          inProgress={inProgress}
          onSubmit={async (url, path) => {
            await cloneRepo(url, path)
          }}
        />
        <InitDialog
          inProgress={inProgress}
          onSubmit={async (path) => {
            const created = await initRepo(path)
            onSelectRepo(created.path)
            return created.url
          }}
        />
      </div>
      {inProgress && progressLabel && <p className='route-copy'>Progress: {progressLabel}</p>}
      {mutationError && <p className='route-copy'>Operation failed: {mutationError}</p>}

      {loading && <p className='route-copy'>Loading repositories...</p>}
      {!loading && error && (
        <p className='route-copy'>Unable to load repositories: {error}</p>
      )}
      {!loading && !error && repositories.length === 0 && (
        <p className='route-copy'>No repositories have been discovered yet (empty state).</p>
      )}
      {!loading && !error && repositories.length > 0 && (
        <ul className='repo-list' aria-label='Known repositories'>
          {repositories.map((repo) => (
            <li key={repo.path}>
              <button
                type='button'
                className='repo-item'
                aria-current={selectedPath === repo.path ? 'true' : undefined}
                onClick={() => onSelectRepo(repo.path)}
              >
                <span className='repo-item__path'>{repo.path}</span>
                <span className='repo-item__url'>{repo.url ?? 'No gittorrent:// URL yet'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
