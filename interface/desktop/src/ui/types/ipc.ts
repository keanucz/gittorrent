export type UiErrorCode =
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED'
  | 'NETWORK_UNAVAILABLE'
  | 'COMMAND_FAILED'
  | 'INTERNAL'

export interface UiError {
  code: UiErrorCode
  message: string
  details?: string
}

export interface RepoSummary {
  path: string
  url?: string
}

export interface RepoInitRequest {
  path: string
}

export interface RepoInitResponse {
  path: string
  url: string
}

export interface RepoCloneRequest {
  url: string
  path: string
}

export interface RepoCloneResponse {
  path: string
  url: string
}

export interface RepoStatusRequest {
  path: string
}

export interface RepoStatusResponse {
  repo: string
  peers: number
  signed_length: number
  pending_ops: number
  last_error?: string
}

export interface WriterRecord {
  key: string
  role: string
  indexer: boolean
}

export interface WriterListRequest {
  path: string
}

export interface WriterInviteRequest {
  path: string
  pubkey: string
  indexer: boolean
}

export interface WriterRevokeRequest {
  path: string
  pubkey: string
}

export interface SecretListRequest {
  path: string
}

export interface SecretAddRequest {
  path: string
  filePath: string
}

export interface SecretGetRequest {
  path: string
  secretPath: string
}

export interface SecretRemoveRequest {
  path: string
  secretPath: string
}

export interface SecretListItem {
  path: string
  keyVersion: number
}

export interface SeedStatusRequest {
  path: string
}

export interface SeedStatusResponse {
  active: boolean
  sessionSeconds: number
}

export interface SettingsResponse {
  GITTORRENT_DATA_DIR: string
  GITTORRENT_LOG_LEVEL: string
  GITTORRENT_BOOTSTRAP_NODES: string
  GITTORRENT_SEEDER_KEYS: string
  GITTORRENT_CONNECT_TIMEOUT: string
}

export interface SettingsSetRequest {
  key: string
  value: string
}

export interface RepoPullRequest {
  path: string
}

export interface RepoPushRequest {
  path: string
  branch: string
}

export interface SyncSummary {
  ok: boolean
  message: string
}
