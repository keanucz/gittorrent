import { useEffect, useState } from 'react'
import { seedStart, seedStatus, seedStop } from '../services/tauri-api'

type SeedRouteProps = {
  selectedPath: string | null
}

export function SeedRoute ({ selectedPath }: SeedRouteProps) {
  const [active, setActive] = useState(false)
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!selectedPath) {
      setActive(false)
      setSessionSeconds(0)
      return
    }

    let mounted = true
    const tick = async () => {
      try {
        const status = await seedStatus({ path: selectedPath })
        if (!mounted) {
          return
        }

        setActive(status.active)
        setSessionSeconds(status.sessionSeconds)
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : 'Unable to load seed status')
        }
      }
    }

    void tick()
    const timer = setInterval(() => {
      void tick()
    }, 1000)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [selectedPath])

  async function startSeed () {
    if (!selectedPath) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      await seedStart({ path: selectedPath })
      const status = await seedStatus({ path: selectedPath })
      setActive(status.active)
      setSessionSeconds(status.sessionSeconds)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to seed start')
    } finally {
      setBusy(false)
    }
  }

  async function stopSeed () {
    if (!selectedPath) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      await seedStop({ path: selectedPath })
      const status = await seedStatus({ path: selectedPath })
      setActive(status.active)
      setSessionSeconds(status.sessionSeconds)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to seed stop')
    } finally {
      setBusy(false)
    }
  }

  function formatDuration (totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return [hours, minutes, seconds].map(v => v.toString().padStart(2, '0')).join(':')
  }

  return (
    <section className='content__panel'>
      <h2 className='route-title'>Seed</h2>
      <p className='route-copy'>Control and monitor explicit seeding sessions and peer availability.</p>
      {!selectedPath && <p className='route-copy'>Select a repository before using seed start/stop controls.</p>}
      {selectedPath && (
        <div className='seed-dashboard'>
          <div className='status-indicator'>
            <span className={`status-dot ${active ? 'status-dot--active' : 'status-dot--inactive'}`} />
            <span className='status-text'>Status: {active ? 'Active' : 'Inactive'}</span>
          </div>
          <p className='route-copy'>Session Duration: <strong>{formatDuration(sessionSeconds)}</strong></p>
          <div className='row-actions'>
            <button type='button' className='sidebar__link' onClick={() => void startSeed()} disabled={busy || active}>Seed Start</button>
            <button type='button' className='sidebar__link' onClick={() => void stopSeed()} disabled={busy || !active}>Seed Stop</button>
          </div>
          {error && <p className='route-copy error-text'>{error}</p>}
        </div>
      )}
    </section>
  )
}
