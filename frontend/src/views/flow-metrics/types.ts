// Response shapes of the /flow-metrics API (backend/tools/flow_metrics/router.py).

export interface DayStats {
  avg: number | null
  p50: number | null
  p85: number | null
}

export interface StageStat extends DayStats {
  stage: string
  label: string
  kind: 'active' | 'wait' | 'queue'
  /** This stage's share of total lead time across all completed issues (0–1). */
  share: number
}

export interface TrendPoint {
  month: string            // YYYY-MM
  count: number
  cycle_p50: number | null
  cycle_p85: number | null
}

export interface FlowIssue {
  key: string
  type: string
  points: number | null
  priority: string
  month: string
  lead: number
  cycle: number
  active: number
  wait: number
  stages: Record<string, number>
}

export interface FlowData {
  months_used: string[]
  completed: number
  cycle: DayStats
  lead: DayStats
  flow_efficiency: number | null
  stages: StageStat[]
  trend: TrendPoint[]
  issues: FlowIssue[]
  jira_url: string
}

export interface AgingItem {
  key: string
  summary: string
  type: string
  status: string
  stage: string
  points: number | null
  in_status_days: number | null
  age_days: number | null
}

export interface AgingData {
  items: AgingItem[]
  /** Historic lead-time P85 (created → done) — the like-for-like reference for age_days. */
  lead_p85: number | null
  jira_url: string
}
