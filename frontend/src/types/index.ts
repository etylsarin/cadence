// Shared domain types used across views, so components don't re-declare shapes.

/** A homepage tool entry, sourced from the backend /api/tools (config.env). */
export interface Tool {
  id: string
  name: string
  desc: string
}

/** Sync mirror state, part of the /api/tools response — tools other than
 *  Sync Now are disabled until the first sync completes. */
export interface SyncState {
  synced: boolean
  last_sync: string | null
}

/** A Jira issue row as consumed by IssueRow and the tool views. */
export interface Issue {
  key: string
  type?: string
  priority?: string
  status?: string
  summary?: string
  injected?: boolean
  approved?: boolean
  delivered?: boolean
  points?: number | string
}
