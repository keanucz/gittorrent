import { useState } from 'react'

type InitDialogProps = {
  inProgress: boolean
  onSubmit: (path: string) => Promise<string>
}

export function InitDialog ({ inProgress, onSubmit }: InitDialogProps) {
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)

  async function submit () {
    if (!path.trim()) {
      setError('Repository path is required.')
      return
    }

    setError(null)
    const url = await onSubmit(path.trim())
    setCreatedUrl(url)
  }

  return (
    <div className='dialog-card'>
      <h3 className='status-card__label'>Initialize Repository</h3>
      <p className='route-copy'>Create a local repository and retrieve the new gittorrent:// URL.</p>
      <label className='field-label' htmlFor='init-path'>Repository Path</label>
      <input id='init-path' className='field-input' value={path} onChange={(event) => setPath(event.target.value)} />
      {error && <p className='route-copy'>Error: {error}</p>}
      {createdUrl && <p className='route-copy'>Created URL: {createdUrl}</p>}
      <button type='button' className='sidebar__link' disabled={inProgress} onClick={() => void submit()}>
        {inProgress ? 'Initializing...' : 'Init'}
      </button>
    </div>
  )
}
