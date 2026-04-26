import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from './ui/components/AppShell'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
)
