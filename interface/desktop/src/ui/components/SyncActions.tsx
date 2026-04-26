import { useState } from 'react'

type SyncActionsProps = {
  selectedPath: string | null
  isBusy: boolean
  onPull: (repoPath: string) => Promise<void>
  onPush: (repoPath: string, branch: string) => Promise<void>
}

export function SyncActions ({ selectedPath, isBusy, onPull, onPush }: SyncActionsProps) {
  const [branch, setBranch] = useState('main')

  if (!selectedPath) {
    return <p className='route-copy'>Select a repository to enable pull and push actions.</p>
  }

  return (
    <section className='sync-actions' aria-label='Sync Actions'>
      <h3 className='status-card__label'>Sync Actions</h3>
      <p className='route-copy'>Run pull/push operations for the selected repository.</p>
      <div className='sync-actions__controls'>
        <button type='button' className='sidebar__link' disabled={isBusy} onClick={() => void onPull(selectedPath)}>
          {isBusy ? 'Busy...' : 'Pull'}
        </button>
        <label className='field-label' htmlFor='push-branch'>Push Branch</label>
        <input id='push-branch' className='field-input' value={branch} onChange={(event) => setBranch(event.target.value)} />
        <button type='button' className='sidebar__link' disabled={isBusy} onClick={() => void onPush(selectedPath, branch)}>
          {isBusy ? 'Busy...' : 'Push'}
        </button>
      </div>
    </section>
  )
}
