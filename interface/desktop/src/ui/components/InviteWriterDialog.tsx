import { useState } from 'react'

type InviteWriterDialogProps = {
  inProgress: boolean
  onInvite: (pubkey: string, indexer: boolean) => Promise<void>
}

const HEX64 = /^[0-9a-fA-F]{64}$/

export function InviteWriterDialog ({ inProgress, onInvite }: InviteWriterDialogProps) {
  const [pubkey, setPubkey] = useState('')
  const [indexer, setIndexer] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit () {
    if (!HEX64.test(pubkey.trim())) {
      setError('Writer pubkey must be a 64-character hex value.')
      return
    }

    setError(null)
    await onInvite(pubkey.trim(), indexer)
    setPubkey('')
    setIndexer(false)
  }

  return (
    <section className='dialog-card' aria-label='Invite writer'>
      <h3 className='status-card__label'>Invite Writer</h3>
      <label className='field-label' htmlFor='invite-pubkey'>Writer Pubkey (hex, 64 chars)</label>
      <input
        id='invite-pubkey'
        className='field-input'
        value={pubkey}
        onChange={(event) => setPubkey(event.target.value)}
      />
      <label className='field-checkbox'>
        <input
          type='checkbox'
          checked={indexer}
          onChange={(event) => setIndexer(event.target.checked)}
        />
        Invite as indexer
      </label>
      {error && <p className='route-copy'>Error: {error}</p>}
      <button type='button' className='sidebar__link' disabled={inProgress} onClick={() => void submit()}>
        {inProgress ? 'Inviting...' : 'Invite'}
      </button>
    </section>
  )
}
