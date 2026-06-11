export interface Sprint {
  id: number
  name: string
  project?: string
  state?: string
  startDate?: string
  endDate?: string
  squads?: string[]
}

export interface SsIssue {
  key: string
  type?: string
  status?: string
  summary?: string
  points?: number
  injected?: boolean
  approved?: boolean
  delivered?: boolean
  removed?: boolean
  epicKey?: string | null
  epicName?: string
  fixVersion?: string
  labels?: string[]
}

interface MetricCell { count: number; points: number }

export interface MetricRow {
  available?: boolean
  count: number
  points: number
  delivered: MetricCell
  approved: MetricCell
  completed: MetricCell
}

export interface SummaryRows {
  planned: MetricRow
  injected: MetricRow
  total: MetricRow
}

export interface SprintSummaryData {
  jiraUrl?: string
  boardId?: number | string
  sprint?: { goal?: string }
  rows: SummaryRows
  issues: SsIssue[]
}
