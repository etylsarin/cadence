import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import AppRouter from './router'
import Login from './views/login/Login'
import { loadProjects } from './constants/squads'
import { auth, loadAuth } from './lib/auth'

// Boot: check the session first — when a login is required and this browser
// doesn't hold one, render only the login page. Otherwise load the configured
// project list before first render so squad selectors and project colors are
// ready everywhere.
async function boot() {
  const root = createRoot(document.getElementById('app')!)
  await loadAuth().catch(() => { /* backend unreachable — render the app shell */ })
  if (auth.required && !auth.authenticated) {
    root.render(
      <StrictMode>
        <Login />
      </StrictMode>,
    )
    return
  }
  await loadProjects()
  root.render(
    <StrictMode>
      <AppRouter />
    </StrictMode>,
  )
}

void boot()
