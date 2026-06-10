import { useCallback, useState } from 'react'
import { SQUADS } from '@/constants/squads'

// Re-exported as a plain string[] so callers can pass it straight to components.
export const ALL_SQUADS: string[] = [...SQUADS]
export const PROJECTS: string[] = ALL_SQUADS.filter((s) => s !== 'ORG')

const KEY = 'cadence:project'

export function storedProject(fallback: string = PROJECTS[0], squads: string[] = PROJECTS): string {
  const stored = localStorage.getItem(KEY)
  return stored && squads.includes(stored) ? stored : fallback
}

export function saveProject(value: string): void {
  localStorage.setItem(KEY, value)
}

/** State pre-initialised from localStorage, validated against `squads`. */
export function useProject(fallback: string = PROJECTS[0], squads: string[] = PROJECTS) {
  const [project, setProjectState] = useState<string>(() => storedProject(fallback, squads))
  const set = useCallback((value: string) => {
    setProjectState(value)
    saveProject(value)
  }, [])
  return { project, PROJECTS: squads, set }
}
