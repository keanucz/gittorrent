import { useCallback, useMemo, useState } from 'react'
import { repoPull, repoPush } from '../services/tauri-api'

type SyncLevel = 'info' | 'success' | 'error'

export type SyncEntry = {
  id: string
  timestamp: string
  repoPath: string
  level: SyncLevel
  message: string
}

type SyncState = {
  runningByRepo: Record<string, boolean>
  entries: SyncEntry[]
}

function makeEntry (repoPath: string, level: SyncLevel, message: string): SyncEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    repoPath,
    level,
    message
  }
}

function buildActionableRejectionMessage (message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('non-fast-forward') || lower.includes('rejected')) {
    return 'Push rejected (non-fast-forward). Run git pull --rebase origin <branch>, resolve conflicts, then push again.'
  }

  return message
}

export function useSyncState () {
  const [state, setState] = useState<SyncState>({
    runningByRepo: {},
    entries: []
  })

  const append = useCallback((entry: SyncEntry) => {
    setState((previous) => ({
      ...previous,
      entries: [entry, ...previous.entries].slice(0, 100)
    }))
  }, [])

  const runSyncOperation = useCallback(async (repoPath: string, action: () => Promise<{ message: string }>) => {
    if (state.runningByRepo[repoPath]) {
      append(makeEntry(repoPath, 'error', 'A sync action is already running for this repository (concurrent actions are blocked).'))
      throw new Error('Sync action already running for selected repository')
    }

    setState((previous) => ({
      ...previous,
      runningByRepo: {
        ...previous.runningByRepo,
        [repoPath]: true
      }
    }))

    try {
      append(makeEntry(repoPath, 'info', 'Sync started'))
      const result = await action()
      append(makeEntry(repoPath, 'success', result.message))
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Sync failed'
      append(makeEntry(repoPath, 'error', buildActionableRejectionMessage(rawMessage)))
      throw error
    } finally {
      setState((previous) => ({
        ...previous,
        runningByRepo: {
          ...previous.runningByRepo,
          [repoPath]: false
        }
      }))
    }
  }, [append, state.runningByRepo])

  const pull = useCallback(async (repoPath: string) => {
    await runSyncOperation(repoPath, async () => {
      append(makeEntry(repoPath, 'info', 'Pull progress: requesting latest refs'))
      const result = await repoPull({ path: repoPath })
      return { message: `Pull completed: ${result.message}` }
    })
  }, [append, runSyncOperation])

  const push = useCallback(async (repoPath: string, branch: string) => {
    await runSyncOperation(repoPath, async () => {
      append(makeEntry(repoPath, 'info', `Push progress: uploading branch ${branch}`))
      const result = await repoPush({ path: repoPath, branch })
      return { message: `Push completed: ${result.message}` }
    })
  }, [append, runSyncOperation])

  const isBusy = useCallback((repoPath: string) => Boolean(state.runningByRepo[repoPath]), [state.runningByRepo])

  const entries = useMemo(() => state.entries, [state.entries])

  return {
    entries,
    isBusy,
    pull,
    push
  }
}
