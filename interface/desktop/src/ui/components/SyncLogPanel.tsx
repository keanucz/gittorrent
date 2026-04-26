import type { SyncEntry } from '../state/sync-state'

type SyncLogPanelProps = {
  entries: SyncEntry[]
  selectedPath: string | null
}

export function SyncLogPanel ({ entries, selectedPath }: SyncLogPanelProps) {
  const visibleEntries = selectedPath
    ? entries.filter((entry) => entry.repoPath === selectedPath)
    : []

  return (
    <section className='sync-log' aria-label='Sync Progress Logs'>
      <h3 className='status-card__label'>Sync Progress</h3>
      {selectedPath === null && <p className='route-copy'>Select a repository to see sync events.</p>}
      {selectedPath !== null && visibleEntries.length === 0 && <p className='route-copy'>No sync events yet.</p>}
      {selectedPath !== null && visibleEntries.length > 0 && (
        <ul className='sync-log__entries'>
          {visibleEntries.map((entry) => (
            <li key={entry.id} className={`sync-log__entry sync-log__entry--${entry.level}`}>
              <span className='sync-log__timestamp'>{entry.timestamp}</span>
              <span>{entry.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
