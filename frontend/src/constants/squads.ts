// Canonical squad list and order used across the whole app.
// Views that don't support all squads should filter from this list
// (never define a local order — import and filter instead).
export const SQUADS = ['ORG', 'ACCS', 'CONS', 'ENGS', 'NBLMNT', 'TRAS'] as const

export type Squad = (typeof SQUADS)[number]
