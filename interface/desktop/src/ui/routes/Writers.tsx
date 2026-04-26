import { useCallback, useEffect, useState } from 'react'
import { InviteWriterDialog } from '../components/InviteWriterDialog'
import { WriterTable } from '../components/WriterTable'
import { writerInvite, writerList, writerRevoke } from '../services/tauri-api'
import { UiApiError } from '../services/tauri-api'
import type { WriterRecord } from '../types/ipc'

type WritersRouteProps = {
  selectedPath: string | null
}

export function WritersRoute ({ selectedPath }: WritersRouteProps) {
  const [rows, setRows] = useState<WriterRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [inProgress, setInProgress] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedPath) {
      setRows([])
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await writerList({ path: selectedPath })
      setRows(response)
    } catch (cause) {
      if (cause instanceof UiApiError && cause.code === 'PERMISSION_DENIED') {
        setError('You are not allowed to manage writers for this repository. Only indexers can invite or revoke.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to load writers')
      }
    } finally {
      setLoading(false)
    }
  }, [selectedPath])

  useEffect(() => {
    void load()
  }, [load])

  async function invite(pubkey: string, indexer: boolean) {
    if (!selectedPath) {
      return
    }

    setInProgress(true)
    setError(null)
    try {
      await writerInvite({ path: selectedPath, pubkey, indexer })
      await load()
    } catch (cause) {
      if (cause instanceof UiApiError && cause.code === 'PERMISSION_DENIED') {
        setError('Invite rejected: you are not an indexer for this repository.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to invite writer')
      }
    } finally {
      setInProgress(false)
    }
  }

  async function revoke(pubkey: string) {
    if (!selectedPath) {
      return
    }

    setInProgress(true)
    setError(null)
    try {
      await writerRevoke({ path: selectedPath, pubkey })
      await load()
    } catch (cause) {
      if (cause instanceof UiApiError && cause.code === 'PERMISSION_DENIED') {
        setError('Revoke rejected: you are not allowed to remove writers from this repository.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to revoke writer')
      }
    } finally {
      setInProgress(false)
    }
  }

  return (
    <section className='content__panel'>
      <h2 className='route-title'>Writers</h2>
      <p className='route-copy'>Manage write access and indexer roles for collaborating peers.</p>
      {!selectedPath && <p className='route-copy'>Select a repository before managing writers.</p>}
      {selectedPath && (
        <>
          <div className='row-actions'>
            <button type='button' className='sidebar__link' onClick={() => void load()} disabled={loading || inProgress}>Refresh Writers</button>
          </div>
          {loading && <p className='route-copy'>Loading writers...</p>}
          {error && <p className='route-copy'>{error}</p>}
          <div className='dialog-grid'>
            <InviteWriterDialog inProgress={inProgress} onInvite={invite} />
          </div>
          <WriterTable rows={rows} inProgress={inProgress} onRevoke={revoke} />
        </>
      )}
    </section>
  )
}
