import { useSyncExternalStore } from 'react'

/**
 * App-wide dark mode, ported from the Vue useDarkMode composable (a module-level
 * singleton ref). Here it's a tiny external store so every component shares the
 * same value and stays in sync with the <html class="dark"> toggle + localStorage.
 */

const STORAGE_KEY = 'cadence:dark'

let darkValue = localStorage.getItem(STORAGE_KEY) === 'true'
const listeners = new Set<() => void>()

function apply(value: boolean) {
  document.documentElement.classList.toggle('dark', value)
}

// Apply immediately on module load (matches the Vue behaviour).
apply(darkValue)

function setDark(value: boolean) {
  darkValue = value
  apply(value)
  localStorage.setItem(STORAGE_KEY, String(value))
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDarkMode() {
  const dark = useSyncExternalStore(subscribe, () => darkValue)
  return {
    dark,
    toggle: () => setDark(!darkValue),
  }
}
