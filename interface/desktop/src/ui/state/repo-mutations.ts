import { useCallback, useState } from 'react'
import { repoClone, repoInit } from '../services/tauri-api'
import type { RepoCloneResponse, RepoInitResponse } from '../types/ipc'

type MutationState = {
  inProgress: boolean
  progressLabel: string | null
  error: string | null
}

type RepoMutationHooks = {
  inProgress: boolean
  progressLabel: string | null
  error: string | null
  cloneRepo: (url: string, path: string) => Promise<RepoCloneResponse>
  initRepo: (path: string) => Promise<RepoInitResponse>
}

export function useRepoMutations (onSuccess?: () => Promise<void> | void): RepoMutationHooks {
  const [state, setState] = useState<MutationState>({
    inProgress: false,
    progressLabel: null,
    error: null
  })

  const runMutation = useCallback(async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
    setState({ inProgress: true, progressLabel: label, error: null })

    try {
      const result = await action()
      if (onSuccess) {
        await onSuccess()
      }
      setState({ inProgress: false, progressLabel: null, error: null })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operation failed'
      setState({ inProgress: false, progressLabel: null, error: message })
      throw error
    }
  }, [onSuccess])

  const cloneRepo = useCallback(async (url: string, path: string) => {
    return runMutation('Cloning repository', async () => repoClone({ url, path }))
  }, [runMutation])

  const initRepo = useCallback(async (path: string) => {
    return runMutation('Initializing repository', async () => repoInit({ path }))
  }, [runMutation])

  return {
    inProgress: state.inProgress,
    progressLabel: state.progressLabel,
    error: state.error,
    cloneRepo,
    initRepo
  }
}
