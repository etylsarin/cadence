import { api } from '@/lib/api'
import { setProjColors } from '@/lib/tags'

// Canonical squad list and order used across the whole app, populated once at
// startup (see main.tsx) from /api/config — config.env PROJECTS is the single
// source of truth. 'ALL' is the synthetic "all projects" entry.
// Views that don't support all projects should filter from this list
// (never define a local order — import and filter instead).
export const SQUADS: string[] = []
export const PROJECTS: string[] = []

export type Squad = (typeof SQUADS)[number]

/** Fetch the configured project keys and populate SQUADS/PROJECTS in place. */
export async function loadProjects(): Promise<void> {
  try {
    const cfg = await api<{ projects?: string[] }>('/api/config')
    const projects = cfg.projects ?? []
    PROJECTS.splice(0, PROJECTS.length, ...projects)
    SQUADS.splice(0, SQUADS.length, 'ALL', ...projects)
    setProjColors(projects)
  } catch {
    // Backend unreachable — leave the lists empty; views degrade gracefully.
  }
}
