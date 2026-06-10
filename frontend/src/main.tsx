import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import AppRouter from './router'
import { loadProjects } from './constants/squads'

// Load the configured project list before first render so squad selectors and
// project colors are ready everywhere.
loadProjects().finally(() => {
  createRoot(document.getElementById('app')!).render(
    <StrictMode>
      <AppRouter />
    </StrictMode>,
  )
})
