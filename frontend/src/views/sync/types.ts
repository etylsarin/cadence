export interface SyncStatus {
  running: boolean
  started_at?: string | null
  last_sync?: string | null
  bronze_count?: number | null
  silver_count?: number | null
  config?: {
    jira_url?: string
    projects?: string
    issue_types?: string
    start_date?: string
  }
}

export interface Transformation {
  id: string
  name: string
  description?: string
  output?: string
  rows?: number | null
  updated_at?: string | null
}

export interface LogSummary {
  type?: string
  stages?: string
  done?: boolean
  errors?: string
  tickets?: string
  new?: string
  updated?: string
  deleted?: string
  time?: string
  duration_s?: number
}

export interface LogEntry { name: string; summary: LogSummary }
