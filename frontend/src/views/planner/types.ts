import type { SimResult } from './simulate'

export interface TeamConfig {
  id: string
  name: string
  throughputPerMonth: number
  contingencyPct: number
  tailWorkdays: number
}

export interface ScenarioOn {
  /** null = use the team's configured contingency; a number overrides it. */
  contingencyPct: number | null
  extraCapacityPct: number
  excludeTypes: string[]
  dropPriorities: string[]
}

export interface EpicChild {
  key: string
  summary: string
  type: string
  status: string
  parent: string
}

/** An epic as listed by /planner/api/epics (or a user-created custom epic). */
export interface RecentEpic {
  key: string
  summary: string
  status?: string
  priority?: string
  created?: string
  updated?: string
  child_count?: number
  child_status_counts?: Record<string, number>
  custom?: boolean
  customItems?: number
  priorityLevel?: string
}

/** An epic the user added to the plan. */
export interface SelectedEpic {
  key: string
  summary: string
  project: string
  color: string
  children: EpicChild[]
  status_breakdown: Record<string, number>
  priorityLevel: string
  overrideTitle?: string
  overrideItems?: number
  earliestStartWorkday: number
  laneIndex: number
  custom: boolean
  customItems?: number
}

export interface EpicOverride {
  overrideTitle?: string
  overrideItems?: number
  priorityLevel?: string
}

export interface ReorderChange {
  epicKey: string
  targetIndexInSquad: number
  earliestStartWorkday?: number | null
  laneIndex?: number | null
}

export interface EpicEditPayload {
  key: string
  custom: boolean
  fields: { title?: string; items?: number; priority?: string }
  baseline: { title: string; items: number }
}

export type Baseline = SimResult
