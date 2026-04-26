import { StatusCards } from '../components/StatusCards'
import { SyncActions } from '../components/SyncActions'
import { SyncLogPanel } from '../components/SyncLogPanel'
import { useRepoStatus } from '../state/repo-queries'
import { useSyncState } from '../state/sync-state'

type RepositoryDetailRouteProps = {
  selectedPath: string | null
}

export function RepositoryDetailRoute ({ selectedPath }: RepositoryDetailRouteProps) {
  const { loading, status, error, hasSelection, refresh } = useRepoStatus({
    repoPath: selectedPath,
    refreshIntervalMs: 10_000
  })
  const { entries, isBusy, pull, push } = useSyncState()

  return (
    <section className='content__panel'>
      <h2 className='route-title'>Repo Detail</h2>
      <p className='route-copy'>Inspect selected repository metadata, peers, and synchronization summaries.</p>

      {!hasSelection && (
        <p className='route-copy'>Select a repository from the list to view status metrics.</p>
      )}

      {hasSelection && (
        <>
          <div className='row-actions'>
            <button type='button' className='sidebar__link' onClick={() => void refresh()}>Refresh Status</button>
          </div>
          <p className='route-copy'>Selected path: {selectedPath}</p>
          {loading && <p className='route-copy'>Loading latest status...</p>}
          {!loading && error && (
            <p className='route-copy'>Status error: {error}. Retry with Refresh Status.</p>
          )}
          {!loading && !error && status && <StatusCards status={status} />}
          <SyncActions
            selectedPath={selectedPath}
            isBusy={selectedPath ? isBusy(selectedPath) : false}
            onPull={pull}
            onPush={push}
          />
          <SyncLogPanel selectedPath={selectedPath} entries={entries} />
        </>
      )}
    </section>
  )
}
