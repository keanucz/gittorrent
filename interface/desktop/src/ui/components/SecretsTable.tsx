import type { SecretListItem } from '../types/ipc'

type SecretsTableProps = {
  rows: SecretListItem[]
  inProgress: boolean
  onPreview: (secretPath: string) => Promise<void>
  onRemove: (secretPath: string) => Promise<void>
}

export function SecretsTable ({ rows, inProgress, onPreview, onRemove }: SecretsTableProps) {
  return (
    <section className='writer-table' aria-label='Secrets table'>
      <h3 className='status-card__label'>Secrets</h3>
      {rows.length === 0 && <p className='route-copy'>No secret paths found.</p>}
      {rows.length > 0 && (
        <table className='table'>
          <thead>
            <tr>
              <th>Secret Path</th>
              <th>Key Version</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path}>
                <td className='table__mono'>{row.path}</td>
                <td>{row.keyVersion}</td>
                <td>
                  <div className='table-actions'>
                    <button type='button' className='sidebar__link' disabled={inProgress} onClick={() => void onPreview(row.path)}>Preview</button>
                    <button type='button' className='sidebar__link' disabled={inProgress} onClick={() => void onRemove(row.path)}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
