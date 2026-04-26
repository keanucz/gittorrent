import { useState } from 'react'

type CloneDialogProps = {
  inProgress: boolean
  onSubmit: (url: string, path: string) => Promise<void>
}

const GITTORRENT_URL_PATTERN = /^gittorrent:\/\/[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/

export function CloneDialog ({ inProgress, onSubmit }: CloneDialogProps) {
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit () {
    if (!GITTORRENT_URL_PATTERN.test(url.trim())) {
      setError('Clone URL must match gittorrent://<base58-key>.')
      return
    }

    if (!path.trim()) {
      setError('Clone path is required.')
      return
    }

    setError(null)
    await onSubmit(url.trim(), path.trim())
    setUrl('')
    setPath('')
  }

  return (
    <div className='dialog-card'>
      <h3 className='status-card__label'>Clone Repository</h3>
      <p className='route-copy'>Clone from a gittorrent:// URL into an absolute destination path.</p>
      <label className='field-label' htmlFor='clone-url'>gittorrent:// URL</label>
      <input id='clone-url' className='field-input' value={url} onChange={(event) => setUrl(event.target.value)} />
      <label className='field-label' htmlFor='clone-path'>Destination Path</label>
      <input id='clone-path' className='field-input' value={path} onChange={(event) => setPath(event.target.value)} />
      {error && <p className='route-copy'>Error: {error}</p>}
      <button type='button' className='sidebar__link' disabled={inProgress} onClick={() => void submit()}>
        {inProgress ? 'Cloning...' : 'Clone'}
      </button>
    </div>
  )
}
