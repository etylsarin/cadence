import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import AppRouter from './router'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
