import { useCallback, useEffect, useMemo, useState } from 'react'
import { repoList, repoStatus } from '../services/tauri-api'
import type { RepoStatusResponse, RepoSummary } from '../types/ipc'

type QueryState<T> = {
  loading: boolean
  data: T
  error: string | null
}

export function useRepoList () {
  const [state, setState] = useState<QueryState<RepoSummary[]>>({
    loading: true,
    data: [],
    error: null
  })

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: null }))

    try {
      const data = await repoList()
      setState({ loading: false, data, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load repositories'
      setState({ loading: false, data: [], error: message })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    loading: state.loading,
    repositories: state.data,
    error: state.error,
    refresh
  }
}

type RepoStatusOptions = {
  repoPath: string | null
  refreshIntervalMs?: number
}

export function useRepoStatus ({ repoPath, refreshIntervalMs = 10_000 }: RepoStatusOptions) {
  const [state, setState] = useState<QueryState<RepoStatusResponse | null>>({
    loading: false,
    data: null,
    error: null
  })

  const refresh = useCallback(async () => {
    if (!repoPath) {
      setState({ loading: false, data: null, error: null })
      return
    }

    setState((previous) => ({ ...previous, loading: true, error: null }))

    try {
      const data = await repoStatus({ path: repoPath })
      setState({ loading: false, data, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load status'
      setState({ loading: false, data: null, error: message })
    }
  }, [repoPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!repoPath) {
      return
    }

    const timer = setInterval(() => {
      void refresh()
    }, refreshIntervalMs)

    return () => {
      clearInterval(timer)
    }
  }, [repoPath, refresh, refreshIntervalMs])

  const hasSelection = useMemo(() => Boolean(repoPath), [repoPath])

  return {
    loading: state.loading,
    status: state.data,
    error: state.error,
    hasSelection,
    refresh
  }
}
