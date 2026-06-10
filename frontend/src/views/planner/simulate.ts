/**
 * Planner simulation — pure functions, no DOM, no framework. Ported from simulate.js.
 */

const WORKDAYS_PER_MONTH = 20
const WORKDAYS_PER_WEEK = 5

export interface Team {
  id: string
  name: string
  /**
   * Average completed items/month, measured from synced data over the selected
   * timeframe. Because it is measured end-to-end on real deliveries, waits,
   * rework, release queues and contingency are already baked into the rate —
   * no separate knobs. (Later: an AI pass over the epic's tickets can refine
   * the per-epic estimate.)
   */
  throughputPerMonth: number
}

export interface EpicInput {
  id: string
  name: string
  teamId: string
  items: number
  color?: string
  priority?: number
  priorityLevel?: string | null
  earliestStartWorkday?: number
  laneIndex?: number
}

export interface PlanRow {
  teamId: string
  teamName: string
  epicId: string
  epicName: string
  color?: string
  priorityLevel: string | null
  items: number
  laneIndex: number
  plannedStart: Date
  plannedEnd: Date
  durationWorkdays: number
}

export interface TeamPlan { teamId: string; teamName: string; rows: PlanRow[] }

export interface SimResult {
  teamPlans: TeamPlan[]
  allRows: PlanRow[]
  latestEnd: Date
  totalWorkdays: number
  totalWeeks: number
  unassignedEpics: EpicInput[]
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function isWorkday(d: Date): boolean {
  const wd = d.getDay()
  return wd !== 0 && wd !== 6
}

/** Advance `from` by `workdays` workdays (skipping weekends). */
export function addWorkdays(from: Date, workdays: number): Date {
  const out = new Date(from)
  let remaining = Math.max(0, Math.ceil(workdays))
  while (remaining > 0) {
    out.setDate(out.getDate() + 1)
    if (isWorkday(out)) remaining -= 1
  }
  return out
}

/** Count workdays from start (exclusive) to end (inclusive). */
export function countWorkdays(start: Date, end: Date): number {
  if (end <= start) return 0
  const cursor = new Date(start)
  let count = 0
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1)
    if (cursor <= end && isWorkday(cursor)) count += 1
  }
  return count
}

/** Per-team daily throughput in items/day, from the data-derived monthly average. */
export function dailyThroughput(team: Team): number {
  return Number(team.throughputPerMonth || 0) / WORKDAYS_PER_MONTH
}

function simulateSequential(team: Team, assigned: EpicInput[], start: Date): PlanRow[] {
  const perDay = dailyThroughput(team)
  if (perDay <= 0 || !assigned.length) return []
  const rows: PlanRow[] = []
  let cursorWd = 0
  for (const epic of assigned) {
    const items = Number(epic.items || 0)
    if (items <= 0) continue
    const workdays = Math.max(1, Math.ceil(items / perDay - 1e-9))
    const earliestWd = Math.max(0, Math.floor(Number(epic.earliestStartWorkday || 0)))
    const startWd = Math.max(cursorWd, earliestWd)
    const plannedStart = startWd === 0 ? new Date(start) : addWorkdays(start, startWd)
    const plannedEnd = addWorkdays(plannedStart, workdays)
    rows.push({
      teamId: team.id, teamName: team.name, epicId: epic.id, epicName: epic.name, color: epic.color,
      priorityLevel: epic.priorityLevel || null, items, laneIndex: Number(epic.laneIndex || 0),
      plannedStart, plannedEnd, durationWorkdays: workdays,
    })
    cursorWd = startWd + workdays
  }
  return rows
}

interface Lane { laneIndex: number; epics: EpicInput[]; idx: number; end: number; left: number | null; startedAt: number }

function simulateParallel(team: Team, assigned: EpicInput[], start: Date): PlanRow[] {
  const perDay = dailyThroughput(team)
  if (perDay <= 0 || !assigned.length) return []

  const byLane = new Map<number, EpicInput[]>()
  for (const epic of assigned) {
    if (Number(epic.items || 0) <= 0) continue
    const idx = Math.max(0, Number(epic.laneIndex || 0))
    if (!byLane.has(idx)) byLane.set(idx, [])
    byLane.get(idx)!.push(epic)
  }
  if (!byLane.size) return []

  const lanes: Lane[] = [...byLane.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([laneIndex, epics]) => ({ laneIndex, epics, idx: 0, end: 0, left: null, startedAt: 0 }))

  const openTimeOf = (lane: Lane) => {
    const epic = lane.epics[lane.idx]
    return Math.max(lane.end, Math.max(0, Number(epic.earliestStartWorkday || 0)))
  }

  const EPS = 1e-7
  const out: { row: EpicInput & { laneIndex: number }; startWd: number; endWd: number }[] = []
  let t = 0
  let safety = 0
  const hasWork = () => lanes.some((l) => l.idx < l.epics.length)

  while (hasWork()) {
    if (++safety > 100_000) throw new Error('Planner simulation hit safety limit')
    const active: Lane[] = []
    let nextOpen = Infinity
    for (const lane of lanes) {
      if (lane.idx >= lane.epics.length) continue
      const ot = openTimeOf(lane)
      if (t + EPS >= ot) {
        if (lane.left === null) { lane.left = Number(lane.epics[lane.idx].items); lane.startedAt = ot }
        active.push(lane)
      } else {
        nextOpen = Math.min(nextOpen, ot)
      }
    }
    if (!active.length) {
      if (!isFinite(nextOpen)) break
      t = nextOpen
      continue
    }
    const rate = perDay / active.length
    let dt = Infinity
    for (const lane of active) dt = Math.min(dt, lane.left! / rate)
    if (isFinite(nextOpen)) dt = Math.min(dt, nextOpen - t)
    if (!(dt > EPS)) dt = EPS
    t += dt
    for (const lane of active) {
      lane.left! -= rate * dt
      if (lane.left! <= EPS) {
        const epic = lane.epics[lane.idx]
        out.push({ row: { ...epic, laneIndex: lane.laneIndex }, startWd: lane.startedAt, endWd: t })
        lane.idx += 1
        lane.end = t
        lane.left = null
      }
    }
  }

  const toWd = (wd: number) => Math.max(0, Math.ceil(wd - EPS))
  return out.map(({ row, startWd, endWd }) => {
    const s = toWd(startWd)
    const e = Math.max(1, toWd(endWd))
    const durationWorkdays = Math.max(1, e - s)
    const plannedStart = s <= 0 ? new Date(start) : addWorkdays(start, s)
    const plannedEnd = addWorkdays(plannedStart, durationWorkdays)
    return {
      teamId: team.id, teamName: team.name, epicId: row.id, epicName: row.name, color: row.color,
      priorityLevel: row.priorityLevel || null, items: Number(row.items || 0), laneIndex: row.laneIndex,
      plannedStart, plannedEnd, durationWorkdays,
    }
  })
}

export function simulate({ teams, epics, start, focusMode }: { teams: Team[]; epics: EpicInput[]; start: Date; focusMode: 'sequential' | 'parallel' }): SimResult {
  const unassigned = epics.filter((e) => !e.teamId || !teams.find((t) => t.id === e.teamId))
  const teamPlans: TeamPlan[] = []
  const allRows: PlanRow[] = []

  for (const team of teams) {
    const assigned = epics
      .filter((e) => e.teamId === team.id && Number(e.items || 0) > 0)
      .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
    const rows = focusMode === 'parallel' ? simulateParallel(team, assigned, start) : simulateSequential(team, assigned, start)
    teamPlans.push({ teamId: team.id, teamName: team.name, rows })
    allRows.push(...rows)
  }

  const latestEnd = allRows.length ? new Date(Math.max(...allRows.map((r) => r.plannedEnd.getTime()))) : new Date(start)
  const totalWorkdays = allRows.length ? countWorkdays(start, latestEnd) : 0

  return { teamPlans, allRows, latestEnd, totalWorkdays, totalWeeks: Math.ceil(totalWorkdays / WORKDAYS_PER_WEEK), unassignedEpics: unassigned }
}

export function formatDate(d: Date): string {
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === new Date().getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' }
  return d.toLocaleDateString(undefined, opts)
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const EPIC_COLORS = [
  '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#dc2626',
  '#0891b2', '#4f46e5', '#be123c', '#0f766e', '#ca8a04',
  '#7c3aed', '#0ea5e9',
]

export const PRIORITY_LEVELS = ['Critical', 'High', 'Medium', 'Low']

export function normalizePriority(name?: string): string {
  const n = (name || '').trim().toLowerCase()
  return PRIORITY_LEVELS.find((l) => l.toLowerCase() === n) || 'Medium'
}
