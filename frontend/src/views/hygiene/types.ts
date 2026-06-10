// Response shapes of the /hygiene API (backend/tools/hygiene/router.py).

export interface HygieneItem {
  key: string
  type: string
  status: string
  summary: string
  points: number | null
  detail: string
}

export interface RuleResult {
  id: string
  label: string
  description: string
  count: number
  items: HygieneItem[]
}

export interface AuditData {
  scanned: number
  /** Tickets with at least one violation. */
  dirty: number
  clean: number
  /** Total violations (a ticket can break several rules). */
  violations: number
  rules: RuleResult[]
  jira_url: string
}
