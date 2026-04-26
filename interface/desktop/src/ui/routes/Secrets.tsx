import { useCallback, useEffect, useState } from 'react'
import { SecretPreviewDialog } from '../components/SecretPreviewDialog'
import { SecretsTable } from '../components/SecretsTable'
import { secretsAdd, secretsGet, secretsList, secretsRemove, secretsRotate } from '../services/tauri-api'
import type { SecretListItem } from '../types/ipc'

type SecretsRouteProps = {
  selectedPath: string | null
}

function redactSecretText (text: string): string {
  return text
    .replace(/ciphertext:[^\s]+/gi, 'ciphertext:[REDACTED]')
    .replace(/secret material/gi, '[REDACTED_SECRET_MATERIAL]')
}

export function SecretsRoute ({ selectedPath }: SecretsRouteProps) {
  const [rows, setRows] = useState<SecretListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [inProgress, setInProgress] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [addPath, setAddPath] = useState('')
  const [rotateConfirm, setRotateConfirm] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])

  const appendLog = useCallback((line: string) => {
    setLogLines((previous) => [redactSecretText(line), ...previous].slice(0, 30))
  }, [])

  const load = useCallback(async () => {
    if (!selectedPath) {
      setRows([])
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const list = await secretsList({ path: selectedPath })
      setRows(list)
      appendLog('Loaded secrets list metadata')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to list secrets')
      appendLog('Failed to load secrets list: ciphertext:[REDACTED]')
    } finally {
      setLoading(false)
    }
  }, [appendLog, selectedPath])

  useEffect(() => {
    void load()
  }, [load])

  async function addSecret () {
    if (!selectedPath || !addPath.trim()) {
      return
    }

    setInProgress(true)
    setError(null)
    try {
      await secretsAdd({ path: selectedPath, filePath: addPath.trim() })
      appendLog(`Added secret path metadata for ${addPath.trim()}`)
      setAddPath('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add secret')
      appendLog('Add secret failed: [REDACTED_SECRET_MATERIAL]')
    } finally {
      setInProgress(false)
    }
  }

  async function previewSecret (secretPath: string) {
    if (!selectedPath) {
      return
    }

    setInProgress(true)
    setError(null)
    try {
      const text = await secretsGet({ path: selectedPath, secretPath })
      setPreviewPath(secretPath)
      setPreviewText(text)
      appendLog(`Loaded in-memory preview for ${secretPath}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to preview secret')
      appendLog('Preview failed: ciphertext:[REDACTED]')
    } finally {
      setInProgress(false)
    }
  }

  async function removeSecret (secretPath: string) {
    if (!selectedPath) {
      return
    }

    setInProgress(true)
    setError(null)
    try {
      await secretsRemove({ path: selectedPath, secretPath })
      appendLog(`Removed secret path ${secretPath}`)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove secret')
      appendLog('Remove failed: [REDACTED_SECRET_MATERIAL]')
    } finally {
      setInProgress(false)
    }
  }

  async function rotateSecrets () {
    if (!selectedPath || rotateConfirm !== 'ROTATE') {
      return
    }

    setInProgress(true)
    setError(null)
    try {
      await secretsRotate({ path: selectedPath })
      appendLog('Rotate complete for secret key version metadata')
      setRotateConfirm('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to rotate secrets key')
      appendLog('Rotate failed: ciphertext:[REDACTED]')
    } finally {
      setInProgress(false)
    }
  }

  return (
    <section className='content__panel'>
      <h2 className='route-title'>Secrets</h2>
      <p className='route-copy'>Handle encrypted secret files with clear status and key-version context.</p>
      {!selectedPath && <p className='route-copy'>Select a repository before managing secrets.</p>}
      {selectedPath && (
        <>
          <div className='row-actions'>
            <button type='button' className='sidebar__link' onClick={() => void load()} disabled={loading || inProgress}>Refresh Secrets</button>
          </div>

          <div className='dialog-grid'>
            <section className='dialog-card'>
              <h3 className='status-card__label'>Add Secret</h3>
              <label className='field-label' htmlFor='secret-file-path'>Secret File Path</label>
              <input id='secret-file-path' className='field-input' value={addPath} onChange={(event) => setAddPath(event.target.value)} />
              <button type='button' className='sidebar__link' disabled={inProgress} onClick={() => void addSecret()}>Add Secret</button>
            </section>

            <section className='dialog-card'>
              <h3 className='status-card__label'>Rotate Secret Key</h3>
              <p className='route-copy'>Type ROTATE to confirm key rotation.</p>
              <label className='field-label' htmlFor='rotate-confirm'>Confirm</label>
              <input id='rotate-confirm' className='field-input' value={rotateConfirm} onChange={(event) => setRotateConfirm(event.target.value)} />
              <button type='button' className='sidebar__link' disabled={inProgress || rotateConfirm !== 'ROTATE'} onClick={() => void rotateSecrets()}>Confirm Rotate</button>
            </section>
          </div>

          {loading && <p className='route-copy'>Loading secrets list...</p>}
          {error && <p className='route-copy'>{error}</p>}

          <SecretsTable rows={rows} inProgress={inProgress} onPreview={previewSecret} onRemove={removeSecret} />
          <SecretPreviewDialog
            secretPath={previewPath}
            previewText={previewText}
            onClose={() => {
              setPreviewPath(null)
              setPreviewText(null)
            }}
          />

          <section className='sync-log' aria-label='Secrets logs'>
            <h3 className='status-card__label'>Secrets Logs</h3>
            {logLines.length === 0 && <p className='route-copy'>No secret events yet.</p>}
            {logLines.length > 0 && (
              <ul className='sync-log__entries'>
                {logLines.map((line) => (
                  <li key={line} className='sync-log__entry sync-log__entry--info'>{line}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  )
}
