import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsRoute } from './Settings'
import * as tauriApi from '../services/tauri-api'

vi.mock('../services/tauri-api')

describe('SettingsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(tauriApi.settingsGet).mockResolvedValue({
      PEAR_GIT_DATA_DIR: '/home/user/.pear-git',
      PEAR_GIT_LOG_LEVEL: 'info',
      PEAR_GIT_BOOTSTRAP_NODES: '',
      PEAR_GIT_SEEDER_KEYS: '',
      PEAR_GIT_CONNECT_TIMEOUT: '10000'
    })
  })

  it('loads and displays current settings', async () => {
    render(<SettingsRoute />)

    await waitFor(() => {
      const input = screen.getByLabelText(/Storage Directory/i) as HTMLInputElement
      expect(input.value).toBe('/home/user/.pear-git')
    })
  })

  it('saves a setting when Save button is clicked', async () => {
    vi.mocked(tauriApi.settingsSet).mockResolvedValue({ ok: true, message: 'Updated' })

    render(<SettingsRoute />)

    const input = await screen.findByLabelText(/Storage Directory/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '/new/path' } })
    
    const saveBtn = screen.getAllByRole('button', { name: /Save/i })[0]
    fireEvent.click(saveBtn)

    expect(tauriApi.settingsSet).toHaveBeenCalledWith({
      key: 'PEAR_GIT_DATA_DIR',
      value: '/new/path'
    })
  })

  it('applies log level immediately when Apply Now is clicked', async () => {
    vi.mocked(tauriApi.settingsSet).mockResolvedValue({ ok: true, message: 'Updated' })
    vi.mocked(tauriApi.setLogLevel).mockResolvedValue({ ok: true, message: 'Applied' })

    render(<SettingsRoute />)

    const select = await screen.findByLabelText(/Log Verbosity/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'debug' } })

    const applyBtn = screen.getByRole('button', { name: /Apply Now/i })
    fireEvent.click(applyBtn)

    expect(tauriApi.setLogLevel).toHaveBeenCalledWith('debug')
  })
})
