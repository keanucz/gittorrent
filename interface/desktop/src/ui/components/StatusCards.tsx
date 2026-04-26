import type { RepoStatusResponse } from '../types/ipc'

type StatusCardsProps = {
  status: RepoStatusResponse
}

type MetricCard = {
  label: string
  value: string
}

export function StatusCards ({ status }: StatusCardsProps) {
  const cards: MetricCard[] = [
    { label: 'Peers', value: String(status.peers) },
    { label: 'Signed Length', value: String(status.signed_length) },
    { label: 'Pending Ops', value: String(status.pending_ops) },
    { label: 'Last Sync Error', value: status.last_error ?? 'None' }
  ]

  return (
    <div className='status-grid' aria-label='Repository status metrics'>
      {cards.map((card) => (
        <article key={card.label} className='status-card'>
          <h3 className='status-card__label'>{card.label}</h3>
          <p className='status-card__value'>{card.value}</p>
        </article>
      ))}
    </div>
  )
}
