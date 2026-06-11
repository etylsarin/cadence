/**
 * Shared tag/badge utilities (ported from useTags.js).
 * Used by TagBadge.tsx.
 */

export type TagKind = 'type' | 'priority' | 'status' | 'scope' | 'outcome' | 'project'

export interface TagProps {
  label: string
  cls: string
  projColor?: string
}

// Color palette assigned to projects by their position in config.env PROJECTS
// (cycling when there are more projects than colors); ALL is fixed.
const PROJ_PALETTE = ['#4472C4', '#70AD47', '#FFC000', '#C00000', '#7030A0']

export const PROJ_COLORS: Record<string, string> = {
  ALL: '#111111',
}

/** Populate PROJ_COLORS for the configured projects (called at startup). */
export function setProjColors(projects: string[]): void {
  for (const [i, p] of projects.entries()) PROJ_COLORS[p] = PROJ_PALETTE[i % PROJ_PALETTE.length]
}

/**
 * Resolve display properties for a badge.
 * Returns { label, cls, projColor }.
 * Note: type/priority icons are rendered by TagBadge.tsx — not handled here.
 */
export function getTagProps(kind: TagKind, value?: string): TagProps {
  const v  = value ?? ''
  const vl = v.toLowerCase()

  if (kind === 'type') {
    if (vl.includes('epic'))                         return { label: v, cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' }
    if (vl.includes('impr') || vl.includes('feat'))  return { label: v, cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
    return { label: v, cls: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300' }
  }

  if (kind === 'priority') {
    return { label: v, cls: '' }
  }

  if (kind === 'status') {
    const GREEN  = new Set(['delivered', 'rejected', 'closed', 'done', 'resolved'])
    const ORANGE = new Set(['approved for prod env'])
    if (GREEN.has(vl))  return { label: v, cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' }
    if (ORANGE.has(vl)) return { label: v, cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' }
    return { label: v, cls: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-300' }
  }

  if (kind === 'scope') {
    if (vl === 'injected') return { label: 'Injected', cls: 'border border-gray-900 text-gray-900 bg-white dark:border-slate-600 dark:text-slate-500 dark:bg-transparent' }
    return { label: 'Planned', cls: 'border border-gray-900 bg-gray-900 text-white dark:border-slate-500 dark:bg-slate-600 dark:text-gray-200' }
  }

  if (kind === 'outcome') {
    if (vl === 'delivered') return { label: 'Delivered', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' }
    if (vl === 'approved')  return { label: 'Approved',  cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400' }
    return { label: 'Not Done', cls: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-300' }
  }

  // kind === 'project' — uses inline style for dynamic color
  return { label: v, cls: '', projColor: PROJ_COLORS[v] ?? '#4a9eff' }
}
