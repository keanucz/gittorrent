import { useState } from 'react'
import type { WriterRecord } from '../types/ipc'

type WriterTableProps = {
  rows: WriterRecord[]
  inProgress: boolean
  onRevoke: (pubkey: string) => Promise<void>
}

export function WriterTable ({ rows, inProgress, onRevoke }: WriterTableProps) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  async function revoke (pubkey: string) {
    if (confirmText !== 'REVOKE') {
      return
    }

    await onRevoke(pubkey)
    setConfirmKey(null)
    setConfirmText('')
  }

  return (
    <section className='writer-table' aria-label='Writers table'>
      <h3 className='status-card__label'>Writers</h3>
      {rows.length === 0 && <p className='route-copy'>No writers found for this repository.</p>}
      {rows.length > 0 && (
        <table className='table'>
          <thead>
            <tr>
              <th>Key</th>
              <th>Role</th>
              <th>Indexer</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((writer) => (
              <tr key={writer.key}>
                <td className='table__mono'>{writer.key}</td>
                <td>{writer.role}</td>
                <td>{writer.indexer ? 'Yes' : 'No'}</td>
                <td>
                  {confirmKey === writer.key
                    ? (
                      <div className='confirm-inline'>
                        <label className='field-label' htmlFor={`confirm-${writer.key}`}>Type REVOKE to confirm</label>
                        <input
                          id={`confirm-${writer.key}`}
                          className='field-input'
                          value={confirmText}
                          onChange={(event) => setConfirmText(event.target.value)}
                        />
                        <button
                          type='button'
                          className='sidebar__link'
                          disabled={inProgress || confirmText !== 'REVOKE'}
                          onClick={() => void revoke(writer.key)}
                        >
                          Confirm Revoke
                        </button>
                      </div>
                      )
                    : (
                      <button
                        type='button'
                        className='sidebar__link'
                        disabled={inProgress}
                        onClick={() => {
                          setConfirmKey(writer.key)
                          setConfirmText('')
                        }}
                      >
                        Revoke
                      </button>
                      )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
