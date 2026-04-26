import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SeedRoute } from './Seed'
import * as tauriApi from '../services/tauri-api'

vi.mock('../services/tauri-api')

describe('SeedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a prompt when no path is selected', () => {
    render(<SeedRoute selectedPath={null} />)
    expect(screen.getByText(/Select a repository/i)).toBeDefined()
  })

  it('loads and displays seed status', async () => {
    const mockStatus = { active: true, sessionSeconds: 3600 }
    vi.mocked(tauriApi.seedStatus).mockResolvedValue(mockStatus)

    render(<SeedRoute selectedPath="/path/to/repo" />)

    await waitFor(() => {
      expect(screen.getByText(/Status: Active/i)).toBeDefined()
      expect(screen.getByText(/01:00:00/i)).toBeDefined()
    })
  })

  it('calls seedStart when Start button is clicked', async () => {
    vi.mocked(tauriApi.seedStatus).mockResolvedValue({ active: false, sessionSeconds: 0 })
    vi.mocked(tauriApi.seedStart).mockResolvedValue({ ok: true, message: 'Started' })

    render(<SeedRoute selectedPath="/path/to/repo" />)

    const startBtn = await screen.findByRole('button', { name: /Seed Start/i })
    fireEvent.click(startBtn)

    expect(tauriApi.seedStart).toHaveBeenCalledWith({ path: '/path/to/repo' })
  })

  it('calls seedStop when Stop button is clicked', async () => {
    vi.mocked(tauriApi.seedStatus).mockResolvedValue({ active: true, sessionSeconds: 120 })
    vi.mocked(tauriApi.seedStop).mockResolvedValue({ ok: true, message: 'Stopped' })

    render(<SeedRoute selectedPath="/path/to/repo" />)

    const stopBtn = await screen.findByRole('button', { name: /Seed Stop/i })
    fireEvent.click(stopBtn)

    expect(tauriApi.seedStop).toHaveBeenCalledWith({ path: '/path/to/repo' })
  })
})
