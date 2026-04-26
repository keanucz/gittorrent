import { useEffect, useState } from 'react'
import { setLogLevel, settingsGet, settingsSet } from '../services/tauri-api'

type SettingsForm = {
  GITTORRENT_DATA_DIR: string
  GITTORRENT_LOG_LEVEL: string
  GITTORRENT_BOOTSTRAP_NODES: string
  GITTORRENT_SEEDER_KEYS: string
  GITTORRENT_CONNECT_TIMEOUT: string
}

export function SettingsRoute () {
  const [form, setForm] = useState<SettingsForm>({
    GITTORRENT_DATA_DIR: '',
    GITTORRENT_LOG_LEVEL: 'info',
    GITTORRENT_BOOTSTRAP_NODES: '',
    GITTORRENT_SEEDER_KEYS: '',
    GITTORRENT_CONNECT_TIMEOUT: '10000'
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const settings = await settingsGet()
        if (!mounted) {
          return
        }

        setForm({
          GITTORRENT_DATA_DIR: settings.GITTORRENT_DATA_DIR,
          GITTORRENT_LOG_LEVEL: settings.GITTORRENT_LOG_LEVEL,
          GITTORRENT_BOOTSTRAP_NODES: settings.GITTORRENT_BOOTSTRAP_NODES,
          GITTORRENT_SEEDER_KEYS: settings.GITTORRENT_SEEDER_KEYS,
          GITTORRENT_CONNECT_TIMEOUT: settings.GITTORRENT_CONNECT_TIMEOUT
        })
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : 'Unable to load settings')
        }
      }
    }

    void load()

    return () => {
      mounted = false
    }
  }, [])

  async function saveKey (key: keyof SettingsForm) {
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      await settingsSet({ key, value: form[key] })
      if (key === 'GITTORRENT_LOG_LEVEL') {
        await setLogLevel(form.GITTORRENT_LOG_LEVEL)
        setNotice('Log verbosity updated without restart.')
      } else {
        setNotice(`${key} saved.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save setting')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className='content__panel'>
      <h2 className='route-title'>Settings</h2>
      <p className='route-copy'>Tune desktop defaults, logging, and bootstrap node configuration.</p>
      <div className='settings-grid'>
        <div className='settings-group'>
          <h3>Core Defaults</h3>
          <div className='field-group'>
            <label className='field-label' htmlFor='set-data-dir'>Storage Directory (GITTORRENT_DATA_DIR)</label>
            <input id='set-data-dir' className='field-input' value={form.GITTORRENT_DATA_DIR} onChange={(event) => setForm((p) => ({ ...p, GITTORRENT_DATA_DIR: event.target.value }))} placeholder='~/.gittorrent' />
            <button type='button' className='sidebar__link' disabled={busy} onClick={() => void saveKey('GITTORRENT_DATA_DIR')}>Save</button>
          </div>

          <div className='field-group'>
            <label className='field-label' htmlFor='set-log-level'>Log Verbosity (GITTORRENT_LOG_LEVEL)</label>
            <select id='set-log-level' className='field-input' value={form.GITTORRENT_LOG_LEVEL} onChange={(event) => setForm((p) => ({ ...p, GITTORRENT_LOG_LEVEL: event.target.value }))}>
              <option value='error'>Error</option>
              <option value='warn'>Warning</option>
              <option value='info'>Info</option>
              <option value='debug'>Debug</option>
              <option value='trace'>Trace</option>
            </select>
            <button type='button' className='sidebar__link' disabled={busy} onClick={() => void saveKey('GITTORRENT_LOG_LEVEL')}>Apply Now</button>
          </div>
        </div>

        <div className='settings-group'>
          <h3>Network & DHT</h3>
          <div className='field-group'>
            <label className='field-label' htmlFor='set-bootstrap'>Bootstrap Nodes (GITTORRENT_BOOTSTRAP_NODES)</label>
            <input id='set-bootstrap' className='field-input' value={form.GITTORRENT_BOOTSTRAP_NODES} onChange={(event) => setForm((p) => ({ ...p, GITTORRENT_BOOTSTRAP_NODES: event.target.value }))} placeholder='host:port,host:port' />
            <button type='button' className='sidebar__link' disabled={busy} onClick={() => void saveKey('GITTORRENT_BOOTSTRAP_NODES')}>Save</button>
          </div>

          <div className='field-group'>
            <label className='field-label' htmlFor='set-seeder-keys'>Default Seeder Keys (GITTORRENT_SEEDER_KEYS)</label>
            <input id='set-seeder-keys' className='field-input' value={form.GITTORRENT_SEEDER_KEYS} onChange={(event) => setForm((p) => ({ ...p, GITTORRENT_SEEDER_KEYS: event.target.value }))} placeholder='gittorrent://key1,gittorrent://key2' />
            <button type='button' className='sidebar__link' disabled={busy} onClick={() => void saveKey('GITTORRENT_SEEDER_KEYS')}>Save</button>
          </div>

          <div className='field-group'>
            <label className='field-label' htmlFor='set-timeout'>Connect Timeout (ms)</label>
            <input id='set-timeout' className='field-input' type='number' value={form.GITTORRENT_CONNECT_TIMEOUT} onChange={(event) => setForm((p) => ({ ...p, GITTORRENT_CONNECT_TIMEOUT: event.target.value }))} />
            <button type='button' className='sidebar__link' disabled={busy} onClick={() => void saveKey('GITTORRENT_CONNECT_TIMEOUT')}>Save</button>
          </div>
        </div>
      </div>
      {notice && <p className='route-copy'>{notice}</p>}
      {error && <p className='route-copy'>{error}</p>}
    </section>
  )
}
