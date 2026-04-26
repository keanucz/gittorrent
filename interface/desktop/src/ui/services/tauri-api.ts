import { invoke } from '@tauri-apps/api/core'
import type {
    RepoCloneRequest,
    RepoCloneResponse,
    RepoInitRequest,
    RepoInitResponse,
    RepoPullRequest,
    RepoPushRequest,
    RepoStatusRequest,
    RepoStatusResponse,
    RepoSummary,
    SyncSummary,
    UiError,
    UiErrorCode,
    SecretAddRequest,
    SecretGetRequest,
    SecretListItem,
    SecretListRequest,
    SecretRemoveRequest,
    SeedStatusRequest,
    SeedStatusResponse,
    SettingsResponse,
    SettingsSetRequest,
    WriterInviteRequest,
    WriterListRequest,
    WriterRecord,
    WriterRevokeRequest
} from '../types/ipc'

type TauriErrorShape = {
  code?: UiErrorCode
  message?: string
  details?: string
}

export class UiApiError extends Error {
  readonly code: UiErrorCode
  readonly details?: string

  constructor (error: UiError) {
    super(error.message)
    this.code = error.code
    this.details = error.details
  }
}

function isTauriErrorShape (value: unknown): value is TauriErrorShape {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.message === 'string' || typeof candidate.code === 'string'
}

export function mapTauriError (error: unknown): UiError {
  if (isTauriErrorShape(error)) {
    return {
      code: (error.code ?? 'INTERNAL') as UiErrorCode,
      message: error.message ?? 'Unexpected desktop bridge error',
      details: error.details
    }
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL',
      message: error.message
    }
  }

  return {
    code: 'INTERNAL',
    message: 'Unknown desktop bridge error'
  }
}

async function invokeTyped<T> (command: string, payload?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload)
  } catch (error) {
    throw new UiApiError(mapTauriError(error))
  }
}

export async function healthCheck (): Promise<string> {
  return invokeTyped<string>('health_check')
}

export async function repoList (): Promise<RepoSummary[]> {
  return invokeTyped<RepoSummary[]>('repo_list')
}

export async function repoStatus (request: RepoStatusRequest): Promise<RepoStatusResponse> {
  return invokeTyped<RepoStatusResponse>('repo_status', { path: request.path })
}

export async function repoInit (request: RepoInitRequest): Promise<RepoInitResponse> {
  return invokeTyped<RepoInitResponse>('repo_init', { path: request.path })
}

export async function repoClone (request: RepoCloneRequest): Promise<RepoCloneResponse> {
  return invokeTyped<RepoCloneResponse>('repo_clone', {
    path: request.path,
    url: request.url
  })
}

export async function repoPull (request: RepoPullRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('repo_pull', { path: request.path })
}

export async function repoPush (request: RepoPushRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('repo_push', {
    path: request.path,
    branch: request.branch
  })
}

export async function repoRemove (path: string): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('repo_remove', { path })
}

export async function repoTouch (path: string): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('repo_touch', { path })
}

export async function writerList (request: WriterListRequest): Promise<WriterRecord[]> {
  return invokeTyped<WriterRecord[]>('writer_list', { path: request.path })
}

export async function writerInvite (request: WriterInviteRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('writer_invite', {
    path: request.path,
    pubkey: request.pubkey,
    indexer: request.indexer
  })
}

export async function writerRevoke (request: WriterRevokeRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('writer_revoke', {
    path: request.path,
    pubkey: request.pubkey
  })
}

export async function secretsList (request: SecretListRequest): Promise<SecretListItem[]> {
  return invokeTyped<SecretListItem[]>('secrets_list', { path: request.path })
}

export async function secretsAdd (request: SecretAddRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('secrets_add', {
    path: request.path,
    filePath: request.filePath
  })
}

export async function secretsGet (request: SecretGetRequest): Promise<string> {
  return invokeTyped<string>('secrets_get', {
    path: request.path,
    secretPath: request.secretPath
  })
}

export async function secretsRemove (request: SecretRemoveRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('secrets_remove', {
    path: request.path,
    secretPath: request.secretPath
  })
}

export async function secretsRotate (request: SecretListRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('secrets_rotate', { path: request.path })
}

export async function seedStart (request: SeedStatusRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('seed_start', { path: request.path })
}

export async function seedStop (request: SeedStatusRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('seed_stop', { path: request.path })
}

export async function seedStatus (request: SeedStatusRequest): Promise<SeedStatusResponse> {
  return invokeTyped<SeedStatusResponse>('seed_status', { path: request.path })
}

export async function settingsGet (): Promise<SettingsResponse> {
  return invokeTyped<SettingsResponse>('settings_get')
}

export async function settingsSet (request: SettingsSetRequest): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('settings_set', {
    key: request.key,
    value: request.value
  })
}

export async function setLogLevel (value: string): Promise<SyncSummary> {
  return invokeTyped<SyncSummary>('set_log_level', { value })
}
