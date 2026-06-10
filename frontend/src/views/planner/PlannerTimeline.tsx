import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarRange, Rows3, Columns3, ChevronsRightLeft, ChevronsLeft, ChevronsRight,
  Trash2, MapPin, FlagTriangleRight, FlagTriangleLeft, CalendarDays, GripVertical,
} from 'lucide-react'
import AppInfoPanel from '@/components/AppInfoPanel'
import AppTooltip from '@/components/AppTooltip'
import { PROJ_COLORS } from '@/lib/tags'
import { formatDate, shortDate, dailyThroughput, countWorkdays, ymd, type SimResult, type PlanRow } from './simulate'
import type { TeamConfig, ScenarioOn, ReorderChange } from './types'
import './planner.css'

// ── Geometry constants ─────────────────────────────────────────────────────────
const LABEL_COL_PX = 96
const LANE_HEIGHT = 56     // taller lane: room for two-line bar text
const BAR_HEIGHT = 44      // bar grows to fit two lines + item ticks
const MIN_PX_PER_WD = 1.2
const VIEWPORT_WORKDAYS: Record<string, number> = { month: 20, quarter: 60, year: 240 }
const NONAUTO_LEFT_PAD_WD = 2
const SPAN_LABEL_MARGIN = 6
const FINE_GRID_MIN_PX = 6

const EXCLUDE_TYPES = ['Story', 'Bug', 'Task', 'Spike']
const DROP_TIERS = ['Low', 'Medium', 'High']   // Critical is never droppable

type Scale = 'auto' | 'month' | 'quarter' | 'year'

// ── Date helpers (module-level, mirror simulate.ts semantics) ─────────────────
function addMonths(d: Date, n: number): Date { const r = new Date(d); r.setMonth(r.getMonth() + n); return r }

function subtractWorkdays(d: Date, n: number): Date {
  const out = new Date(d)
  let remaining = Math.max(0, Math.ceil(n))
  while (remaining > 0) {
    out.setDate(out.getDate() - 1)
    const wd = out.getDay()
    if (wd !== 0 && wd !== 6) remaining -= 1
  }
  return out
}
function addWorkdaysSafe(from: Date, workdays: number): Date {
  const out = new Date(from)
  let remaining = Math.max(0, Math.floor(workdays))
  while (remaining > 0) {
    out.setDate(out.getDate() + 1)
    const wd = out.getDay()
    if (wd !== 0 && wd !== 6) remaining -= 1
  }
  return out
}
function workdaysBetween(origin: Date, date: Date): number {
  if (date <= origin) return 0
  let count = 0
  const cursor = new Date(origin)
  while (cursor < date) {
    cursor.setDate(cursor.getDate() + 1)
    const wd = cursor.getDay()
    if (wd !== 0 && wd !== 6) count += 1
  }
  return count
}
function formatDropLabel(date: Date): string {
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' })
  const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${weekday}, ${monthDay}`
}

// ── Axis marker labels + iterators ─────────────────────────────────────────────
const quarterLabel = (d: Date) => 'Q' + (Math.floor(d.getMonth() / 3) + 1)
const monthLabel = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' })
const yearLabel = (d: Date) => String(d.getFullYear())
const shortYear = (d: Date) => "'" + String(d.getFullYear()).slice(-2)
const isCurrentYear = (d: Date) => d.getFullYear() === new Date().getFullYear()
const monthYearLabel = (d: Date) => (isCurrentYear(d) ? monthLabel(d) : `${shortYear(d)} ${monthLabel(d)}`)
const quarterYearLabel = (d: Date) => (isCurrentYear(d) ? quarterLabel(d) : `${shortYear(d)} ${quarterLabel(d)}`)

interface Marker { date: Date; offset: number }

function* iterMondays(origin: Date, totalWd: number): Generator<Marker> {
  const c = new Date(origin)
  const shift = (8 - c.getDay()) % 7
  c.setDate(c.getDate() + (shift === 0 ? 0 : shift))
  while (true) {
    const offset = workdaysBetween(origin, c)
    if (offset > totalWd) break
    yield { date: new Date(c), offset }
    c.setDate(c.getDate() + 7)
  }
}
function* iterMonthStarts(origin: Date, totalWd: number): Generator<Marker> {
  const c = new Date(origin); c.setDate(1)
  while (true) {
    const offset = workdaysBetween(origin, c)
    if (offset > totalWd) break
    yield { date: new Date(c), offset }
    c.setMonth(c.getMonth() + 1)
  }
}
function* iterQuarterStarts(origin: Date, totalWd: number): Generator<Marker> {
  const c = new Date(origin); c.setDate(1)
  c.setMonth(Math.floor(c.getMonth() / 3) * 3)
  while (true) {
    const offset = workdaysBetween(origin, c)
    if (offset > totalWd) break
    yield { date: new Date(c), offset }
    c.setMonth(c.getMonth() + 3)
  }
}
function* iterYearStarts(origin: Date, totalWd: number): Generator<Marker> {
  const c = new Date(origin); c.setDate(1); c.setMonth(0)
  while (true) {
    const offset = workdaysBetween(origin, c)
    if (offset > totalWd) break
    yield { date: new Date(c), offset }
    c.setFullYear(c.getFullYear() + 1)
  }
}

/** Active workdays: union of all bar intervals (gaps excluded). */
function computeActiveWorkdays(b: SimResult | null): number {
  if (!b?.allRows?.length) return 0
  const intervals = b.allRows
    .map((r) => [r.plannedStart.getTime(), r.plannedEnd.getTime()] as [number, number])
    .sort((a, b2) => a[0] - b2[0])
  const merged: [number, number][] = [intervals[0].slice() as [number, number]]
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1]
    if (intervals[i][0] <= last[1]) last[1] = Math.max(last[1], intervals[i][1])
    else merged.push(intervals[i].slice() as [number, number])
  }
  let total = 0
  for (const [s, e] of merged) total += countWorkdays(new Date(s), new Date(e))
  return total
}

function barPriorityCls(level: string | null): string {
  return level === 'Critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
    : level === 'High' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
      : level === 'Medium' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
        : level === 'Low' ? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'
          : 'bg-gray-100 text-gray-500'
}

function deltaClass(delta: number): string {
  return delta < 0 ? 'text-emerald-600 dark:text-emerald-400'
    : delta > 0 ? 'text-amber-600 dark:text-amber-400'
      : 'text-gray-500'
}

function layoutBtnClass(active: boolean): string {
  return active
    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
    : 'border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800'
}

interface DragState {
  epicId: string
  laneKey: string
  targetLaneIndex: number
  pointerX: number
  pointerY: number
  pointerOffsetX: number
  dx: number
  dy: number
  trackLeft: number
  lanesTop: number
  realLaneCount: number
  targetIndex: number
  dropLeftWorkday: number
  outside: boolean
  cursorX: number
  cursorY: number
}
interface StartHandleDrag {
  clientX0: number
  baseStart: Date
  frozenOrigin: Date
  frozenPx: number
}
interface Lane {
  key: string
  laneIndex: number
  label: string
  color: string | null
  rows: PlanRow[]
  isGhost: boolean
}

interface Props {
  squad: string
  team: TeamConfig
  startDate: string
  baseline: SimResult | null
  scenario: SimResult | null
  previewBaseline: SimResult | null
  scenarioOn: ScenarioOn
  showTail?: boolean
  tailPct?: number
  onScenarioOnChange: (s: ScenarioOn) => void
  onTeamChange: (t: TeamConfig) => void
  onStartDateChange: (v: string) => void
  onShowTailChange: (v: boolean) => void
  onDragPreview: (change: ReorderChange | null) => void
  onReorder: (change: ReorderChange) => void
  onRemove: (epicKey: string) => void
  onLayout: (kind: 'split' | 'sequential' | 'tighten') => void
}

export default function PlannerTimeline({
  squad, team, startDate, baseline, scenario, previewBaseline, scenarioOn,
  showTail = true, tailPct = 85,
  onScenarioOnChange, onTeamChange, onStartDateChange, onShowTailChange,
  onDragPreview, onReorder, onRemove, onLayout,
}: Props) {
  const [scale, setScale] = useState<Scale>('auto')
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollX, setScrollX] = useState(0)
  const [spanLabelW, setSpanLabelW] = useState(64)

  const containerRef = useRef<HTMLDivElement>(null)
  const lanesContainerRef = useRef<HTMLDivElement>(null)
  const spanLabelRef = useRef<HTMLDivElement>(null)

  // Drag state: mutable ref (for the window pointer handlers) + state mirror
  // (to trigger renders). Always update both via the setters below.
  const dragRef = useRef<DragState | null>(null)
  const [dragState, _setDragState] = useState<DragState | null>(null)
  const setDrag = useCallback((d: DragState | null) => { dragRef.current = d; _setDragState(d ? { ...d } : null) }, [])

  const startHandleRef = useRef<StartHandleDrag | null>(null)
  const [startHandleDrag, _setStartHandleDrag] = useState<StartHandleDrag | null>(null)
  const setStartHandle = useCallback((s: StartHandleDrag | null) => { startHandleRef.current = s; _setStartHandleDrag(s ? { ...s } : null) }, [])

  // ── Scenario / team setters ─────────────────────────────────────────────────
  const setScen = (key: keyof ScenarioOn, value: unknown) => onScenarioOnChange({ ...scenarioOn, [key]: value } as ScenarioOn)
  const resetScenario = () => onScenarioOnChange({ contingencyPct: null, extraCapacityPct: 0, excludeTypes: [], dropPriorities: [] })
  const setTeamField = (key: keyof TeamConfig, value: unknown) => onTeamChange({ ...team, [key]: value } as TeamConfig)

  const isExcluded = (type: string) => (scenarioOn.excludeTypes || []).includes(type)
  const toggleExcludeType = (type: string) => {
    const cur = scenarioOn.excludeTypes || []
    setScen('excludeTypes', cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type])
  }
  const isDropped = (tier: string) => (scenarioOn.dropPriorities || []).includes(tier)
  const toggleDropTier = (tier: string) => {
    const cur = scenarioOn.dropPriorities || []
    setScen('dropPriorities', cur.includes(tier) ? cur.filter((t) => t !== tier) : [...cur, tier])
  }

  // ── Container resize tracking ───────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => { for (const e of entries) setContainerWidth(e.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [baseline?.allRows?.length])   // re-attach when the chart (de)mounts with the empty state

  useEffect(() => {
    const el = spanLabelRef.current
    if (!el) return
    setSpanLabelW(el.offsetWidth)
    const ro = new ResizeObserver((entries) => { for (const e of entries) setSpanLabelW(e.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  })

  // ── Core geometry (mirrors the Vue computeds; recomputed per render) ────────
  const baselineStartD = useMemo(() => new Date(startDate + 'T00:00:00'), [startDate])

  const todayDate = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayYmd = ymd(todayDate)

  const actualStartDate = useMemo(() => {
    const rows = baseline?.allRows || []
    if (!rows.length) return baselineStartD
    return new Date(Math.min(...rows.map((r) => r.plannedStart.getTime())))
  }, [baseline, baselineStartD])

  const planWorkdays = Math.max(1, countWorkdays(actualStartDate, baseline?.latestEnd || actualStartDate))

  const autoPad = Math.max(1, Math.round(planWorkdays * 0.0556))   // ≈5% breathing margin each side
  const autoFitWorkdays = Math.max(1, countWorkdays(actualStartDate, baseline?.latestEnd || actualStartDate) + 2 * autoPad)

  const pxPerWorkday = (() => {
    if (startHandleDrag) return startHandleDrag.frozenPx
    const avail = Math.max(200, containerWidth - LABEL_COL_PX)
    if (scale === 'auto') {
      if (autoFitWorkdays <= 0) return 8
      return Math.max(MIN_PX_PER_WD, avail / autoFitWorkdays)
    }
    return Math.max(MIN_PX_PER_WD, avail / VIEWPORT_WORKDAYS[scale])
  })()

  const chartOrigin = (() => {
    if (startHandleDrag) return startHandleDrag.frozenOrigin
    if (scale === 'auto') return subtractWorkdays(actualStartDate, planWorkdays + autoPad)
    if (scale === 'year') return addMonths(baselineStartD, -24)
    if (scale === 'quarter') return addMonths(baselineStartD, -6)
    return addMonths(baselineStartD, -2)   // month
  })()

  const chartEndD = (() => {
    const last = baseline?.latestEnd || baselineStartD
    if (scale === 'auto') return addWorkdaysSafe(last, planWorkdays)
    if (scale === 'year') return addMonths(last, 24)
    if (scale === 'quarter') return addMonths(last, 6)
    return addMonths(last, 2)
  })()

  const wdFromOrigin = useCallback((date: Date) => workdaysBetween(chartOrigin, date), [chartOrigin])

  /** Cursor-X workday offset (from chart origin) → earliestStartWorkday (from plan start). */
  const floorFromOriginWorkday = useCallback((originWd: number) => {
    const date = addWorkdaysSafe(chartOrigin, Math.max(0, Math.round(originWd)))
    return countWorkdays(baselineStartD, date)
  }, [chartOrigin, baselineStartD])

  const startX = wdFromOrigin(actualStartDate) * pxPerWorkday
  const barOffset = (row: PlanRow) => wdFromOrigin(row.plannedStart) * pxPerWorkday
  const barWidth = (row: PlanRow) => row.durationWorkdays * pxPerWorkday

  const chartTotalWorkdays = baseline?.allRows?.length ? Math.max(1, wdFromOrigin(chartEndD)) : 0
  const totalWidth = chartTotalWorkdays * pxPerWorkday
  const chartWidth = Math.max(totalWidth, 200)

  const pastWidth = (() => {
    if (todayDate <= chartOrigin) return 0
    return Math.min(wdFromOrigin(todayDate) * pxPerWorkday, totalWidth)
  })()

  const todayX = (() => {
    if (!baseline?.allRows?.length) return null
    if (todayDate < chartOrigin || todayDate > chartEndD) return null
    return wdFromOrigin(todayDate) * pxPerWorkday
  })()

  // ── Rows / lanes ────────────────────────────────────────────────────────────
  const baselineRows = useMemo(() => {
    const tp = (baseline?.teamPlans || []).find((t) => t.teamId === squad)
    return tp?.rows || []
  }, [baseline, squad])

  const displayRows = useMemo(() => {
    const src = dragState && previewBaseline ? previewBaseline : baseline
    const tp = (src?.teamPlans || []).find((t) => t.teamId === squad)
    return tp?.rows || []
  }, [dragState, previewBaseline, baseline, squad])

  const lanes = useMemo<Lane[]>(() => {
    const rows = displayRows.slice().sort((a, b) =>
      (Number(a.laneIndex || 0) - Number(b.laneIndex || 0)) ||
      (a.plannedStart.getTime() - b.plannedStart.getTime()) ||
      (a.plannedEnd.getTime() - b.plannedEnd.getTime()),
    )
    const buckets: PlanRow[][] = []
    for (const row of rows) {
      const floor = Math.max(0, Number(row.laneIndex || 0))
      let placed = false
      for (let i = floor; i < buckets.length; i++) {
        const overlaps = buckets[i].some((r) => !(r.plannedEnd <= row.plannedStart || row.plannedEnd <= r.plannedStart))
        if (!overlaps) { buckets[i].push(row); placed = true; break }
      }
      if (!placed) {
        while (buckets.length < floor) buckets.push([])
        buckets.push([row])
      }
    }
    const used = buckets.filter((b) => b.length > 0)
    used.push([])   // exactly one ghost lane
    return used.map((rs, idx) => {
      const sorted = rs.slice().sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime())
      return {
        key: `lane-${idx}`,
        laneIndex: idx,
        label: sorted.length ? `Lane ${idx + 1}` : '',
        color: sorted.length ? PROJ_COLORS[squad] : null,
        rows: sorted,
        isGhost: sorted.length === 0,
      }
    })
  }, [displayRows, squad])

  const layoutState = useMemo(() => {
    const rows = baselineRows
    if (!rows.length) return { parallel: false, sequential: false, hasGaps: false }
    const startMs = baselineStartD.getTime()
    const byLane = new Map<number, PlanRow[]>()
    for (const r of rows) {
      const idx = Math.max(0, Number(r.laneIndex || 0))
      if (!byLane.has(idx)) byLane.set(idx, [])
      byLane.get(idx)!.push(r)
    }
    let hasGaps = false
    for (const laneRows of byLane.values()) {
      const sorted = laneRows.slice().sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime())
      if (sorted[0].plannedStart.getTime() !== startMs) hasGaps = true
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].plannedStart.getTime() !== sorted[i - 1].plannedEnd.getTime()) hasGaps = true
      }
    }
    const allAtStart = rows.every((r) => r.plannedStart.getTime() === startMs)
    return {
      parallel: rows.length > 1 && byLane.size === rows.length && allAtStart,
      sequential: byLane.size === 1 && !hasGaps,
      hasGaps,
    }
  }, [baselineRows, baselineStartD])

  // ── End / finish markers ─────────────────────────────────────────────────────
  const squadLatestEnd = baselineRows.length ? new Date(Math.max(...baselineRows.map((r) => (r.deliveryEnd || r.plannedEnd).getTime()))) : null
  const squadBodyEnd = baselineRows.length ? new Date(Math.max(...baselineRows.map((r) => r.plannedEnd.getTime()))) : null
  const bodyFinishX = squadBodyEnd ? wdFromOrigin(squadBodyEnd) * pxPerWorkday : 0
  const finishX = squadLatestEnd ? wdFromOrigin(squadLatestEnd) * pxPerWorkday : 0

  // ── Refit / recenter ────────────────────────────────────────────────────────
  const recenterChart = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (scale === 'auto') {
      el.scrollLeft = Math.round(planWorkdays * pxPerWorkday)
    } else {
      const wdToStart = workdaysBetween(chartOrigin, baselineStartD)
      el.scrollLeft = Math.max(0, Math.round((wdToStart - NONAUTO_LEFT_PAD_WD) * pxPerWorkday))
    }
  }, [scale, planWorkdays, pxPerWorkday, chartOrigin, baselineStartD])
  const recenterRef = useRef(recenterChart)
  useEffect(() => { recenterRef.current = recenterChart })

  const actualStartMs = actualStartDate.getTime()
  const latestEndMs = baseline?.latestEnd?.getTime() ?? 0
  const rowCount = baseline?.allRows?.length || 0
  useEffect(() => {
    if (startHandleRef.current || dragRef.current) return
    const raf = requestAnimationFrame(() => recenterRef.current())
    return () => cancelAnimationFrame(raf)
  }, [scale, squad, actualStartMs, latestEndMs, rowCount])

  // ── Span label / annotations ─────────────────────────────────────────────────
  const baselineActiveWorkdays = useMemo(() => computeActiveWorkdays(baseline), [baseline])
  const scenarioActiveWorkdays = useMemo(() => computeActiveWorkdays(scenario), [scenario])
  const baselineActiveWeeks = Math.ceil(baselineActiveWorkdays / 5)
  const durationDelta = scenarioActiveWorkdays - baselineActiveWorkdays

  const spanCalendarDays = baseline?.allRows?.length
    ? Math.max(0, Math.round((baseline.latestEnd.getTime() - actualStartDate.getTime()) / 86_400_000))
    : 0

  const daysToStart = Math.round((baselineStartD.getTime() - todayDate.getTime()) / 86_400_000)
  const daysToDelivery = Math.max(0, Math.round(((baseline?.allRows?.length ? baseline.latestEnd : baselineStartD).getTime() - todayDate.getTime()) / 86_400_000))
  const startSubLabel = daysToStart === 0 ? 'starting today'
    : daysToStart === 1 ? 'starting in 1 day'
      : daysToStart > 1 ? `starting in ${daysToStart} days`
        : daysToStart === -1 ? 'started 1 day ago'
          : `started ${Math.abs(daysToStart)} days ago`

  const spanLabel = (() => {
    const left = LABEL_COL_PX + startX
    const right = LABEL_COL_PX + finishX
    const mid = (left + right) / 2
    const m = SPAN_LABEL_MARGIN
    const half = spanLabelW / 2
    const visL = scrollX + LABEL_COL_PX
    const visR = scrollX + containerWidth
    if (right < visL) return { mode: 'scroll-left' as const, x: visL + m }
    if (left > visR) return { mode: 'scroll-right' as const, x: visR - m }
    const vlo = Math.max(left, visL)
    const vhi = Math.min(right, visR)
    const lo = vlo + half + m
    const hi = vhi - half - m
    if (hi < lo) return { mode: 'hidden' as const, x: mid }
    return { mode: 'label' as const, x: Math.min(Math.max(mid, lo), hi) }
  })()

  function scrollSpanIntoView() {
    const el = containerRef.current
    if (!el) return
    const mid = LABEL_COL_PX + (startX + finishX) / 2
    el.scrollTo({ left: Math.max(0, mid - el.clientWidth / 2), behavior: 'smooth' })
  }

  // ── Axis markers / gridlines ────────────────────────────────────────────────
  const primaryMarkers = useMemo(() => {
    if (chartTotalWorkdays <= 0) return []
    const out: { x: number; label: string }[] = []
    const it = scale === 'year' ? iterYearStarts : scale === 'quarter' ? iterQuarterStarts : iterMonthStarts
    const label = scale === 'year' ? yearLabel : scale === 'quarter' ? quarterYearLabel : monthYearLabel
    for (const m of it(chartOrigin, chartTotalWorkdays)) out.push({ x: m.offset * pxPerWorkday, label: label(m.date) })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, chartOrigin.getTime(), chartTotalWorkdays, pxPerWorkday])

  const secondaryMarkers = useMemo(() => {
    if (chartTotalWorkdays <= 0) return []
    const out: { x: number; label: string }[] = []
    if (scale === 'month') {
      for (const m of iterMondays(chartOrigin, chartTotalWorkdays)) out.push({ x: m.offset * pxPerWorkday, label: String(m.date.getDate()) })
    } else if (scale === 'quarter') {
      for (const m of iterMonthStarts(chartOrigin, chartTotalWorkdays)) out.push({ x: m.offset * pxPerWorkday, label: monthLabel(m.date) })
    } else {
      for (const m of iterQuarterStarts(chartOrigin, chartTotalWorkdays)) out.push({ x: m.offset * pxPerWorkday, label: quarterLabel(m.date) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, chartOrigin.getTime(), chartTotalWorkdays, pxPerWorkday])

  const gridlines = useMemo(() => {
    if (chartTotalWorkdays <= 0) return []
    const xs: number[] = []
    if (scale !== 'year' && pxPerWorkday >= FINE_GRID_MIN_PX) {
      for (let wd = 1; wd < chartTotalWorkdays; wd++) xs.push(wd * pxPerWorkday)
    } else {
      for (const m of iterMondays(chartOrigin, chartTotalWorkdays)) xs.push(m.offset * pxPerWorkday)
    }
    const heavy = new Set(primaryMarkers.map((m) => Math.round(m.x)))
    const out: { x: number; heavy: boolean }[] = []
    for (const m of primaryMarkers) out.push({ x: m.x, heavy: true })
    for (const x of xs) if (!heavy.has(Math.round(x))) out.push({ x, heavy: false })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, chartOrigin.getTime(), chartTotalWorkdays, pxPerWorkday, primaryMarkers])

  // ── Scenario summary ────────────────────────────────────────────────────────
  const contingencyDirty = scenarioOn.contingencyPct != null && Number(scenarioOn.contingencyPct) !== Number(team?.contingencyPct || 0)
  const effectiveContingencyPct = scenarioOn.contingencyPct == null ? Number(team?.contingencyPct || 0) : Number(scenarioOn.contingencyPct)
  const scenarioDirty = contingencyDirty || scenarioOn.extraCapacityPct !== 0 ||
    (scenarioOn.excludeTypes?.length ?? 0) > 0 || (scenarioOn.dropPriorities?.length ?? 0) > 0
  const deltaWorkdays = baseline && scenario ? scenario.totalWorkdays - baseline.totalWorkdays : 0

  const effectivePerWorkday = dailyThroughput({ id: team.id, name: team.name, throughputPerMonth: team.throughputPerMonth, contingencyPct: team.contingencyPct })
  const scenarioThroughputPerMonth = Number(team?.throughputPerMonth || 0) * (1 + Number(scenarioOn?.extraCapacityPct || 0) / 100)
  const tailCalendarDays = Math.round(Number(team?.tailWorkdays || 0) * 7 / 5)

  const scopeEpics = baseline?.allRows?.length || 0
  const scopeItems = (baseline?.allRows || []).reduce((s, r) => s + Number(r.items || 0), 0)
  const scenarioItems = (scenario?.allRows || []).reduce((s, r) => s + Number(r.items || 0), 0)

  const showScenarioGhost = !dragState && scenarioDirty && !!scenario?.allRows?.length
  const scenarioFinishX = scenario ? wdFromOrigin(scenario.latestEnd) * pxPerWorkday : null
  const earlierLater = deltaWorkdays < 0 ? 'earlier' : deltaWorkdays > 0 ? 'later' : 'same'
  const fasterSlower = durationDelta < 0 ? 'faster' : durationDelta > 0 ? 'slower' : 'no change'

  // ── Start-handle drag ───────────────────────────────────────────────────────
  // Stable snapshot of values the window-level pointer handlers need.
  const latest = useRef({ pxPerWorkday, baselineRows, chartOrigin, baselineStartD, barOffset, floorFromOriginWorkday })
  latest.current = { pxPerWorkday, baselineRows, chartOrigin, baselineStartD, barOffset, floorFromOriginWorkday }

  const onStartHandleMove = useCallback((ev: PointerEvent) => {
    const s = startHandleRef.current
    if (!s) return
    const deltaWd = Math.round((ev.clientX - s.clientX0) / Math.max(s.frozenPx, 0.0001))
    const newStart = deltaWd >= 0 ? addWorkdaysSafe(s.baseStart, deltaWd) : subtractWorkdays(s.baseStart, -deltaWd)
    onStartDateChange(ymd(newStart))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStartDateChange])

  const endStartHandle = useCallback(() => {
    setStartHandle(null)
    window.removeEventListener('pointermove', onStartHandleMove)
    window.removeEventListener('pointerup', endStartHandle)
    requestAnimationFrame(() => recenterRef.current())
  }, [onStartHandleMove, setStartHandle])

  function startHandlePointerDown(ev: ReactPointerEvent) {
    if (ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    setStartHandle({
      clientX0: ev.clientX,
      baseStart: new Date(baselineStartD),
      frozenOrigin: new Date(chartOrigin),
      frozenPx: pxPerWorkday,
    })
    window.addEventListener('pointermove', onStartHandleMove)
    window.addEventListener('pointerup', endStartHandle)
  }

  // ── Bar drag ────────────────────────────────────────────────────────────────
  const onDragMove = useCallback((ev: PointerEvent) => {
    const s = dragRef.current
    if (!s) return
    const L = latest.current
    const next: DragState = { ...s, dx: ev.clientX - s.pointerX, dy: ev.clientY - s.pointerY, cursorX: ev.clientX, cursorY: ev.clientY }

    const rect = containerRef.current?.getBoundingClientRect()
    next.outside = !!rect && (ev.clientX < rect.left || ev.clientY < rect.top)

    const px = Math.max(L.pxPerWorkday, 0.0001)
    const laneFromY = Math.floor((ev.clientY - s.lanesTop) / LANE_HEIGHT)
    next.targetLaneIndex = Math.min(s.realLaneCount, Math.max(0, laneFromY))

    const proposedLeftPx = (ev.clientX - s.pointerOffsetX) - s.trackLeft
    const dropWorkday = Math.max(0, Math.round(proposedLeftPx / px))
    next.dropLeftWorkday = dropWorkday

    let idx = 0
    const dropPx = dropWorkday * px
    for (const r of L.baselineRows) {
      if (r.epicId === s.epicId) continue
      if (L.barOffset(r) < dropPx) idx += 1
    }
    next.targetIndex = idx

    setDrag(next)
    onDragPreview({
      epicKey: s.epicId,
      targetIndexInSquad: next.targetIndex,
      earliestStartWorkday: L.floorFromOriginWorkday(dropWorkday),
      laneIndex: next.targetLaneIndex,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDragPreview, setDrag])

  const cleanupDrag = useCallback(() => {
    setDrag(null)
    onDragPreview(null)
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', endDragRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDragMove, onDragPreview, setDrag])

  const endDrag = useCallback(() => {
    const s = dragRef.current
    if (!s) { cleanupDrag(); return }
    if (s.outside) {
      onRemove(s.epicId)
      cleanupDrag()
      return
    }
    const moved = Math.abs(s.dx) > 3 || Math.abs(s.dy || 0) > 3
    if (moved) {
      onReorder({
        epicKey: s.epicId,
        targetIndexInSquad: s.targetIndex,
        earliestStartWorkday: latest.current.floorFromOriginWorkday(s.dropLeftWorkday),
        laneIndex: s.targetLaneIndex,
      })
    }
    cleanupDrag()
  }, [cleanupDrag, onRemove, onReorder])
  const endDragRef = useRef(endDrag)
  useEffect(() => { endDragRef.current = endDrag })

  function startDrag(ev: ReactPointerEvent, row: PlanRow, laneKey: string) {
    if (ev.button !== 0) return
    ev.preventDefault()
    const realLaneCount = lanes.filter((l) => !l.isGhost).length
    const barEl = ev.currentTarget as HTMLElement
    const trackEl = barEl?.parentElement || null
    const trackRect = trackEl ? trackEl.getBoundingClientRect() : { left: 0 }
    const barRect = barEl ? barEl.getBoundingClientRect() : { left: 0 }
    const lanesRect = lanesContainerRef.current?.getBoundingClientRect() || { top: 0 }
    setDrag({
      epicId: row.epicId,
      laneKey,
      targetLaneIndex: Math.max(0, Number(row.laneIndex || 0)),
      pointerX: ev.clientX,
      pointerY: ev.clientY,
      pointerOffsetX: ev.clientX - barRect.left,
      dx: 0, dy: 0,
      trackLeft: trackRect.left,
      lanesTop: lanesRect.top,
      realLaneCount,
      targetIndex: Math.max(0, baselineRows.findIndex((r) => r.epicId === row.epicId)),
      dropLeftWorkday: wdFromOrigin(row.plannedStart),
      outside: false,
      cursorX: ev.clientX,
      cursorY: ev.clientY,
    })
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', endDragRef.current)
  }

  // Unmount cleanup.
  useEffect(() => () => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', endDragRef.current)
    window.removeEventListener('pointermove', onStartHandleMove)
    window.removeEventListener('pointerup', endStartHandle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Bar rendering helpers ───────────────────────────────────────────────────
  const isFrame = (row: PlanRow) => !!dragState && dragState.epicId === row.epicId
  const isGhostBar = (row: PlanRow) => !!dragState && dragState.epicId !== row.epicId

  function itemTickStyle(row: PlanRow): CSSProperties {
    const items = Math.max(1, Number(row.items || 0))
    if (items < 2) return {}
    const w = barWidth(row)
    if (w <= 0) return {}
    const segPx = w / items
    if (segPx < 8) return {}
    return {
      backgroundImage:
        'linear-gradient(135deg, rgba(255,255,255,0.40) 0, rgba(255,255,255,0.40) 7px, transparent 7.5px, transparent 100%)',
      backgroundSize: `${segPx}px 100%`,
      backgroundRepeat: 'repeat-x',
      backgroundPosition: '0 0',
    }
  }

  function barStyle(row: PlanRow): CSSProperties {
    const base: CSSProperties = {
      top: `${(LANE_HEIGHT - BAR_HEIGHT) / 2}px`,
      height: `${BAR_HEIGHT}px`,
      left: `${barOffset(row)}px`,
      width: `${barWidth(row)}px`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'flex-start',
      textAlign: 'left',
      padding: '10px 10px 4px 10px',
      lineHeight: '1.15',
    }
    if (isFrame(row)) {
      const col = dragState?.outside ? '#dc2626' : row.color
      return { ...base, backgroundColor: 'transparent', border: `2px dashed ${col}`, color: col }
    }
    if (isGhostBar(row)) return { ...base, backgroundColor: row.color, opacity: 0.4, ...itemTickStyle(row) }
    return { ...base, backgroundColor: row.color, ...itemTickStyle(row) }
  }

  function barClass(row: PlanRow): string {
    return [
      dragState ? 'pointer-events-none' : 'cursor-grab',
      dragState ? 'transition-[left,width] duration-150 ease-out' : 'transition-[left,width] duration-200 ease-out',
      isFrame(row) ? 'z-[3]' : 'z-[1] text-white',
    ].join(' ')
  }

  function tailWidth(row: PlanRow): number {
    if (!showTail) return 0
    return Math.max(0, Number(row.tailWorkdays || 0)) * pxPerWorkday
  }
  const tailOffset = (row: PlanRow) => barOffset(row) + barWidth(row)
  function tailStyle(row: PlanRow): CSSProperties | null {
    const w = tailWidth(row)
    if (w <= 0) return null
    const h = Math.max(6, Math.round(BAR_HEIGHT * 0.35))
    return {
      top: `${(LANE_HEIGHT - h) / 2}px`,
      left: `${tailOffset(row)}px`,
      width: `${w}px`,
      height: `${h}px`,
      backgroundColor: row.color,
      opacity: 0.32,
      backgroundImage:
        'repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0, rgba(255,255,255,0.55) 3px, transparent 3px, transparent 7px)',
      borderRadius: '2px',
    }
  }
  function tailDiamondHidden(row: PlanRow, lane: Lane, rowIdx: number): boolean {
    if (rowIdx >= lane.rows.length - 1) return false
    const next = lane.rows[rowIdx + 1]
    if (!next) return false
    const t = row.deliveryEnd.getTime()
    return t > next.plannedStart.getTime() && t < next.plannedEnd.getTime()
  }

  const draggedPreviewRow = dragState ? displayRows.find((r) => r.epicId === dragState.epicId) || null : null
  const draggedLabelX = draggedPreviewRow ? barOffset(draggedPreviewRow) : null
  const draggedLabelDate = draggedPreviewRow ? formatDropLabel(draggedPreviewRow.plannedStart) : null

  const numInputCls = 'tabular-nums text-gray-900 dark:text-gray-100 bg-transparent rounded border border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500 focus:border-blue-400 dark:focus:border-blue-500 focus:outline-none px-1.5 py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-outer-spin-button]:m-0'

  return (
    <section>
      {/* "Release to remove" badge — portal pinned to the cursor. */}
      {dragState?.outside && createPortal(
        <div
          className="fixed z-[9999] flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap bg-red-600 text-white px-2 py-1 rounded shadow-lg pointer-events-none"
          style={{ left: `${dragState.cursorX + 14}px`, top: `${dragState.cursorY + 14}px` }}
        >
          <Trash2 size={12} />Release to remove
        </div>,
        document.body,
      )}

      <AppInfoPanel trigger={<h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Timeline</h2>}>
        <div>
          <div className="font-semibold text-gray-800 dark:text-gray-200 mb-1">How it works</div>
          <ul className="space-y-1 list-disc list-inside">
            <li><span className="font-medium">Throughput</span> (items / mo) is pre-filled from Sync gold; <span className="font-medium">Contingency %</span> reduces effective throughput. Both are editable in the strip above the metric boxes.</li>
            <li><span className="font-medium">Start</span> sets when the plan begins — click the date in the Start box (a calendar picker; past dates are disabled) <em>or</em> drag the green <span className="font-medium">Start</span> handle on the chart to slide the whole plan.</li>
            <li><span className="font-medium">Drag bars horizontally</span> to set when each epic starts. Bars that overlap in time share the squad's daily capacity equally and split into their own swimlanes automatically. <span className="font-medium">Drag a bar off the top or left edge</span> of the chart to remove it from the plan.</li>
            <li><span className="font-medium">Lanes</span> are queues — bars inside the same lane stay back-to-back; bars in different lanes share the squad's daily capacity in parallel.</li>
            <li><span className="font-medium">Layout helpers</span>: <em>Parallel</em> drops every epic into its own lane at the plan start; <em>Sequential</em> stacks them into one lane; <em>Remove gaps</em> pulls every lane back-to-back without touching lane assignments.</li>
            <li><span className="font-medium">Scale</span> picks the zoom — Auto fits the plan exactly; Month / Quarter / Year are fixed zoom levels. Every scale has matching scroll room on both sides, so you can scroll back past Start or forward past End.</li>
            <li><span className="font-medium">Release tail</span> (toggle in the toolbar) appends a faded hatched tail after each epic, sized from the P{tailPct} <code className="text-[10px] bg-gray-100 dark:bg-slate-800 px-1 rounded">wait_release</code> time for the selected timeframe (calendar days, converted to workdays for the axis). The team's capacity flows into the next epic during the tail, so intermediate tails overlap visually and only the final tail pushes the delivery date out. Earlier idle waits (wait_testing / wait_sit / wait_uat) sit between work stages and are already baked into throughput, so they're not counted here.</li>
          </ul>
        </div>
      </AppInfoPanel>

      {/* Team rate (editable) strip */}
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Throughput</div>
          <div className="flex items-baseline gap-1.5">
            <input
              key={`tp-${team.throughputPerMonth}`}
              defaultValue={team.throughputPerMonth ?? 0}
              onChange={(e) => setTeamField('throughputPerMonth', Math.max(0, Math.round(Number(e.target.value || 0))))}
              type="number" min={0} step={1}
              className={`w-16 text-xl font-bold ${numInputCls}`}
            />
            <span className="text-[11px] text-gray-500">items/mo</span>
            {scenarioDirty && scenarioOn.extraCapacityPct !== 0 && (
              <span className={`text-[11px] font-medium tabular-nums ${scenarioOn.extraCapacityPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                → {Math.round(scenarioThroughputPerMonth)} ({scenarioOn.extraCapacityPct >= 0 ? '+' : ''}{scenarioOn.extraCapacityPct}%)
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5 tabular-nums">≈ {effectivePerWorkday.toFixed(2)}/workday after contingency</div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Contingency</div>
          <div className="flex items-baseline gap-1.5">
            <input
              key={`ct-${team.contingencyPct}`}
              defaultValue={team.contingencyPct ?? 0}
              onChange={(e) => setTeamField('contingencyPct', Math.min(100, Math.max(0, Number(e.target.value || 0))))}
              type="number" min={0} max={100}
              className={`w-12 text-xl font-bold ${numInputCls}`}
            />
            <span className="text-[11px] text-gray-500">%</span>
            {contingencyDirty && (
              <span className={`text-[11px] font-medium tabular-nums ${effectiveContingencyPct < (team.contingencyPct || 0) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>→ {effectiveContingencyPct}%</span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">off the team's throughput</div>
        </div>

        <label className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-slate-800/50">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Release tail</div>
          <div className="flex items-baseline gap-1.5">
            <input type="checkbox" checked={showTail} onChange={(e) => onShowTailChange(e.target.checked)} className="cursor-pointer w-4 h-4 align-middle" />
            <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{team?.tailWorkdays || 0}</span>
            <span className="text-[11px] text-gray-500">wd</span>
            <span className="text-[10px] text-gray-400 tabular-nums">P{tailPct} · ≈{tailCalendarDays}d</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">wait_release tail per epic</div>
        </label>
      </div>

      {/* Key planner metrics */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Start (editable) */}
        <div className="rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Start</div>
          <label className="relative inline-flex items-center gap-1.5 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Click to change the plan start date">
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">{formatDate(baselineStartD)}</span>
            <CalendarDays size={18} className="text-gray-400 dark:text-gray-500 shrink-0" />
            <input
              type="date"
              value={startDate}
              min={todayYmd}
              onChange={(e) => { if (e.target.value) onStartDateChange(e.target.value) }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer dark:[color-scheme:dark]"
            />
          </label>
          <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">{startSubLabel}</div>
          <div className="text-[11px] mt-0.5 leading-4 min-h-[1rem]" />
        </div>

        {/* Scope */}
        <div className="rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Scope</div>
          {scenarioDirty && scenario ? (
            <>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{scenarioItems} <span className="text-base font-normal text-gray-500">items</span></div>
              <div className={`text-sm font-bold mt-1 tabular-nums ${deltaClass(scenarioItems - scopeItems)}`}>
                {scenarioItems !== scopeItems ? <>{scenarioItems > scopeItems ? '+' : '−'}{Math.abs(scenarioItems - scopeItems)} items</> : 'no change'}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">was {scopeItems} items · {scopeEpics} {scopeEpics === 1 ? 'epic' : 'epics'}</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{scopeItems} <span className="text-base font-normal text-gray-500">items</span></div>
              <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">across {scopeEpics} {scopeEpics === 1 ? 'epic' : 'epics'}</div>
              <div className="text-[11px] mt-0.5 leading-4 min-h-[1rem]" />
            </>
          )}
        </div>

        {/* Duration */}
        <div className="rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Duration</div>
          {scenarioDirty && scenario ? (
            <>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{scenarioActiveWorkdays} <span className="text-base font-normal text-gray-500">workdays</span></div>
              <div className={`text-sm font-bold mt-1 tabular-nums ${deltaClass(durationDelta)}`}>
                {durationDelta !== 0 ? <>{durationDelta > 0 ? '+' : '−'}{Math.abs(durationDelta)} wd {fasterSlower}</> : 'no change'}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">was {baselineActiveWorkdays} wd · ≈ {baselineActiveWeeks} wks</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{baselineActiveWorkdays} <span className="text-base font-normal text-gray-500">workdays</span></div>
              <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">≈ {baselineActiveWeeks} weeks of active work</div>
              <div className="text-[11px] mt-0.5 leading-4 min-h-[1rem]" />
            </>
          )}
        </div>

        {/* Delivery */}
        <div className="rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Delivery</div>
          {scenarioDirty && scenario && baseline ? (
            <>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">{formatDate(scenario.latestEnd)}</div>
              <div className={`text-sm font-bold mt-1 tabular-nums ${deltaClass(deltaWorkdays)}`}>
                {deltaWorkdays !== 0 ? <>{deltaWorkdays > 0 ? '+' : '−'}{Math.abs(deltaWorkdays)} wd {earlierLater}</> : 'no change'}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">was {formatDate(baseline.latestEnd)}</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">{formatDate(baseline ? baseline.latestEnd : baselineStartD)}</div>
              <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">all work delivered in {daysToDelivery} days</div>
              <div className="text-[11px] mt-0.5 leading-4 min-h-[1rem]" />
            </>
          )}
        </div>
      </div>

      {!baseline?.allRows?.length ? (
        <div className="mt-6 py-12 flex flex-col items-center text-center rounded-lg border border-dashed border-gray-200 dark:border-slate-700 text-gray-400 dark:text-gray-500">
          <CalendarRange size={40} className="text-gray-300 dark:text-gray-600 mb-3" />
          <div className="text-sm font-medium text-gray-600 dark:text-gray-300">No epics in scope yet</div>
          <div className="text-xs mt-1 max-w-xs">
            Tick epics in the <span className="font-medium">Scope</span> table above to see the projected delivery timeline for {squad}.
          </div>
        </div>
      ) : (
        <>
          {/* Toolbar: scale + layout helpers */}
          <div className="mt-4 flex items-center gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-gray-400">Scale</span>
              <div className="flex gap-0.5 rounded bg-gray-100 dark:bg-slate-800 p-0.5">
                {(['auto', 'month', 'quarter', 'year'] as Scale[]).map((s) => (
                  <button
                    key={s}
                    className={`px-2.5 py-0.5 rounded text-xs font-medium capitalize transition-colors ${scale === s ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
                    onClick={() => setScale(s)}
                  >{s}</button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[10px] uppercase tracking-wide text-gray-400">Layout</span>
              <button
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors ${layoutBtnClass(layoutState.parallel)}`}
                aria-pressed={layoutState.parallel}
                title={layoutState.parallel ? 'Already fully parallel — every epic in its own lane at the plan start' : 'Put every epic in its own lane, starting at the plan start'}
                onClick={() => onLayout('split')}
              ><Rows3 size={12} />Parallel</button>
              <button
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors ${layoutBtnClass(layoutState.sequential)}`}
                aria-pressed={layoutState.sequential}
                title={layoutState.sequential ? 'Already sequential — one lane, back-to-back from the plan start' : 'Stack everything sequentially in a single lane'}
                onClick={() => onLayout('sequential')}
              ><Columns3 size={12} />Sequential</button>
              <button
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors ${layoutState.hasGaps ? 'border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800' : 'border-gray-100 dark:border-slate-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                disabled={!layoutState.hasGaps}
                title={layoutState.hasGaps ? 'Pull every lane back-to-back, closing the gaps' : 'No gaps to remove — every lane is already flush'}
                onClick={() => onLayout('tighten')}
              ><ChevronsRightLeft size={12} />Remove gaps</button>
            </div>
          </div>

          {/* Gantt */}
          <div ref={containerRef} className="gantt-scroll mt-4 overflow-x-auto pb-2" onScroll={(e) => setScrollX((e.target as HTMLElement).scrollLeft)}>
            <div className="relative" style={{ width: `${LABEL_COL_PX + chartWidth}px`, minWidth: '100%' }}>

              {/* Date stamps */}
              <div className="relative h-12" style={{ width: `${LABEL_COL_PX + chartWidth}px` }}>
                <div
                  className="absolute z-[7] border-t border-dashed border-gray-300 dark:border-slate-600 pointer-events-none"
                  style={{ left: `${LABEL_COL_PX + startX}px`, width: `${Math.max(0, finishX - startX)}px`, top: '32px' }}
                />
                {spanLabel.mode === 'label' ? (
                  <div
                    ref={spanLabelRef}
                    className="absolute z-[8] text-[10px] tabular-nums text-gray-400 dark:text-gray-500 whitespace-nowrap pointer-events-none"
                    title="Active workdays · calendar days"
                    style={{ left: `${spanLabel.x}px`, top: '13px', transform: 'translateX(-50%)' }}
                  >
                    {baselineActiveWorkdays} wd · {spanCalendarDays} days
                  </div>
                ) : spanLabel.mode === 'scroll-left' ? (
                  <button
                    type="button"
                    className="absolute z-[8] inline-flex items-center gap-0.5 text-[10px] tabular-nums whitespace-nowrap text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                    title="Plan span is off-screen — scroll left to see it"
                    style={{ left: `${spanLabel.x}px`, top: '13px' }}
                    onClick={scrollSpanIntoView}
                  ><ChevronsLeft size={12} className="shrink-0" />{baselineActiveWorkdays} wd · {spanCalendarDays} days</button>
                ) : spanLabel.mode === 'scroll-right' ? (
                  <button
                    type="button"
                    className="absolute z-[8] inline-flex items-center gap-0.5 text-[10px] tabular-nums whitespace-nowrap text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                    title="Plan span is off-screen — scroll right to see it"
                    style={{ left: `${spanLabel.x}px`, top: '13px', transform: 'translateX(-100%)' }}
                    onClick={scrollSpanIntoView}
                  >{baselineActiveWorkdays} wd · {spanCalendarDays} days<ChevronsRight size={12} className="shrink-0" /></button>
                ) : null}

                {todayX !== null && (
                  <div
                    title="Today"
                    className="absolute top-1 z-[9] inline-flex items-center gap-1 text-[10px] font-medium tabular-nums bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ left: `${LABEL_COL_PX + todayX}px`, transform: 'translateX(-50%)' }}
                  ><MapPin size={11} className="shrink-0" /> {shortDate(todayDate)}</div>
                )}
                <div
                  title="Drag to slide the whole plan"
                  className={`absolute top-6 z-[10] inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 pl-0.5 pr-1.5 py-0.5 rounded whitespace-nowrap cursor-ew-resize select-none ring-1 ring-transparent hover:ring-emerald-400 touch-none ${startHandleDrag ? 'ring-emerald-500 shadow' : ''}`}
                  style={{ left: `${LABEL_COL_PX + startX}px`, transform: 'translateX(-50%)' }}
                  onPointerDown={startHandlePointerDown}
                >
                  <GripVertical size={11} className="shrink-0 -mr-0.5 opacity-60" /><FlagTriangleRight size={11} className="shrink-0" /> {shortDate(actualStartDate)}
                </div>
                <div
                  title={showTail && finishX > bodyFinishX ? 'Delivery (last item shipped, body + final tail)' : 'End'}
                  className="absolute top-6 z-[8] inline-flex items-center gap-1 text-[10px] font-medium tabular-nums bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded whitespace-nowrap"
                  style={{ left: `${LABEL_COL_PX + finishX}px`, transform: 'translateX(-50%)' }}
                ><FlagTriangleLeft size={11} className="shrink-0" /> {shortDate(squadLatestEnd || baseline.latestEnd)}</div>

                {showTail && bodyFinishX > 0 && finishX > bodyFinishX + 1 && squadBodyEnd && (
                  <div
                    title="Body end — team finished active work; last item still in release queue"
                    className="absolute top-6 z-[7] inline-flex items-center gap-1 text-[10px] tabular-nums bg-white dark:bg-slate-900 text-gray-400 dark:text-gray-500 border border-dashed border-gray-300 dark:border-slate-600 px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ left: `${LABEL_COL_PX + bodyFinishX}px`, transform: 'translateX(-50%)' }}
                  >{shortDate(squadBodyEnd)}</div>
                )}
                {showScenarioGhost && scenarioFinishX !== null && deltaWorkdays !== 0 && scenario && (
                  <div
                    title="What-if delivery"
                    className={`absolute top-6 z-[9] inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded whitespace-nowrap ${deltaWorkdays < 0 ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'}`}
                    style={{ left: `${LABEL_COL_PX + scenarioFinishX}px`, transform: 'translateX(-50%)' }}
                  >{shortDate(scenario.latestEnd)} ({deltaWorkdays > 0 ? '+' : '−'}{Math.abs(deltaWorkdays)} wd)</div>
                )}
              </div>

              {/* Date axis */}
              <div className="flex border-b border-gray-200 dark:border-slate-700 h-9 sticky top-0 z-[6] bg-white dark:bg-slate-900">
                <div className="shrink-0 sticky left-0 z-[7] bg-white dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800" style={{ width: `${LABEL_COL_PX}px` }} />
                <div className="flex-1 relative" style={{ minWidth: `${chartWidth}px` }}>
                  {pastWidth > 0 && (
                    <div className="absolute top-0 bottom-0 bg-gray-100/70 dark:bg-slate-800/40 pointer-events-none" style={{ left: '0px', width: `${pastWidth}px` }} />
                  )}
                  {primaryMarkers.map((m) => (
                    <div key={`p-${m.label}-${m.x}`} className="absolute top-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300 whitespace-nowrap" style={{ left: `${m.x}px` }}>{m.label}</div>
                  ))}
                  {secondaryMarkers.map((m) => (
                    <div key={`s-${m.label}-${m.x}`} className="absolute bottom-0.5 text-[9px] tabular-nums text-gray-400 dark:text-gray-500 whitespace-nowrap pl-1" style={{ left: `${m.x}px` }}>{m.label}</div>
                  ))}
                </div>
              </div>

              {/* Lanes */}
              <div ref={lanesContainerRef} className="relative">
                {/* Shared gridline layer */}
                <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${LABEL_COL_PX}px`, width: `${chartWidth}px` }}>
                  {pastWidth > 0 && <div className="absolute top-0 bottom-0 bg-gray-100/70 dark:bg-slate-800/40" style={{ left: '0px', width: `${pastWidth}px` }} />}
                  {gridlines.map((g) => (
                    <div key={`g-${g.x}`} className={`absolute top-0 bottom-0 w-px ${g.heavy ? 'bg-gray-200 dark:bg-slate-700' : 'bg-gray-100/80 dark:bg-slate-800/80'}`} style={{ left: `${g.x}px` }} />
                  ))}
                  {todayX !== null && <div className="absolute top-0 bottom-0 w-px border-l border-dashed border-blue-500 dark:border-blue-400" style={{ left: `${todayX}px` }} />}
                  {startX > 0 && <div className="absolute top-0 bottom-0 w-px border-l border-dashed border-emerald-400/70 dark:border-emerald-500/70" style={{ left: `${startX}px` }} />}
                  <div className="absolute top-0 bottom-0 w-px border-l border-dashed border-gray-400/70 dark:border-gray-500/70" style={{ left: `${finishX}px` }} />
                  {showScenarioGhost && scenarioFinishX !== null && deltaWorkdays !== 0 && (
                    <>
                      <div
                        className={`absolute top-0 bottom-0 ${deltaWorkdays < 0 ? 'bg-emerald-400/10' : 'bg-amber-400/10'}`}
                        style={{ left: `${Math.min(finishX, scenarioFinishX)}px`, width: `${Math.abs(finishX - scenarioFinishX)}px` }}
                      />
                      <div className={`absolute top-0 bottom-0 w-px border-l-2 border-dashed ${deltaWorkdays < 0 ? 'border-emerald-500' : 'border-amber-500'}`} style={{ left: `${scenarioFinishX}px` }} />
                    </>
                  )}
                </div>

                {lanes.map((lane) => (
                  <div
                    key={lane.key}
                    data-lane-index={lane.laneIndex}
                    className={`flex border-b border-gray-100 dark:border-slate-800 last:border-b-0 transition-colors ${dragState && lane.rows.some((r) => r.epicId === dragState.epicId) ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''}`}
                    style={{ height: `${LANE_HEIGHT}px` }}
                  >
                    <div className="shrink-0 sticky left-0 z-[5] bg-white dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800 flex items-center gap-1.5 px-2 text-[11px]" style={{ width: `${LABEL_COL_PX}px` }}>
                      {lane.color ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lane.color }} />
                          <span className="font-semibold text-gray-700 dark:text-gray-200 truncate" title={lane.label}>{lane.label}</span>
                        </>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600 italic text-[10px]">drop for new lane</span>
                      )}
                    </div>

                    <div className="flex-1 relative" style={{ minWidth: `${chartWidth}px` }}>
                      {/* "starts …" label pinned to the dragged frame's lane */}
                      {dragState && !dragState.outside && draggedLabelX !== null && lane.rows.some((r) => r.epicId === dragState.epicId) && (
                        <div
                          className="absolute inline-flex items-center gap-1 text-[10px] font-medium tabular-nums whitespace-nowrap bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded z-[10] pointer-events-none"
                          style={{ left: `${draggedLabelX}px`, top: lane.laneIndex === 0 ? `${LANE_HEIGHT - 4}px` : '-20px' }}
                        ><CalendarDays size={11} className="shrink-0" /> {draggedLabelDate}</div>
                      )}

                      {/* Bars */}
                      {lane.rows.map((row) => (
                        <AppTooltip
                          key={row.epicId}
                          placement="top"
                          followCursor
                          disabled={!!dragState}
                          className={`absolute rounded text-[10px] font-semibold select-none overflow-hidden ${barClass(row)}`}
                          style={barStyle(row)}
                          data-epic-id={row.epicId}
                          onPointerDown={(e) => startDrag(e, row, lane.key)}
                          content={
                            <div className="min-w-[200px]">
                              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{row.durationWorkdays} workdays</div>
                              <div className="text-[11px] text-gray-500 tabular-nums">{shortDate(row.plannedStart)} → {shortDate(row.plannedEnd)}</div>
                              {showTail && row.tailWorkdays > 0 && (
                                <div className="text-[11px] text-gray-500 tabular-nums mt-0.5">+ {row.tailWorkdays} wd tail · ships {shortDate(row.deliveryEnd)}</div>
                              )}
                              <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-slate-700">
                                <div className="font-mono text-[11px] text-gray-500">{row.epicId}</div>
                                <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200 leading-tight">{row.epicName}</div>
                              </div>
                              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                                <span className="tabular-nums">{row.items} items</span>
                                {row.priorityLevel && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${barPriorityCls(row.priorityLevel)}`}>{row.priorityLevel}</span>}
                              </div>
                            </div>
                          }
                        >
                          <div className="truncate font-semibold">{row.epicName}</div>
                          <div className="truncate text-[9px] font-medium opacity-90 tabular-nums">
                            {row.items} items · {row.durationWorkdays} wd{row.priorityLevel ? <> · {row.priorityLevel}</> : null}
                          </div>
                        </AppTooltip>
                      ))}

                      {/* Tails + delivery diamonds */}
                      {lane.rows.map((row, rowIdx) => {
                        const ts = tailStyle(row)
                        if (!ts) return null
                        return (
                          <span key={`tail-${row.epicId}`}>
                            <AppTooltip
                              placement="top" followCursor
                              className="absolute z-[0] pointer-events-auto"
                              style={ts}
                              content={
                                <>
                                  <div className="text-[11px] text-gray-700 dark:text-gray-200">
                                    <span className="font-semibold">Release tail · {row.tailWorkdays} wd</span>
                                    <span className="text-gray-500"> (P{tailPct} wait_release)</span>
                                  </div>
                                  <div className="text-[11px] text-gray-500 tabular-nums">body ends {shortDate(row.plannedEnd)} → ships {shortDate(row.deliveryEnd)}</div>
                                </>
                              }
                            ><span /></AppTooltip>
                            {!tailDiamondHidden(row, lane, rowIdx) && (
                              <div
                                className="absolute pointer-events-none z-[2]"
                                style={{
                                  left: `${tailOffset(row) + tailWidth(row) - 4}px`,
                                  top: `${LANE_HEIGHT / 2 - 4}px`,
                                  width: '8px', height: '8px',
                                  backgroundColor: row.color,
                                  transform: 'rotate(45deg)',
                                  borderRadius: '1px',
                                }}
                              />
                            )}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tweaks */}
          <div className="mt-14">
            <div className="flex items-start justify-between gap-3">
              <AppInfoPanel trigger={<h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Tweaks</h2>}>
                <div>
                  <div className="font-semibold text-gray-800 dark:text-gray-200 mb-1">How it works</div>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Flip the controls below to ask <em>"what if?"</em> — the impact is shown live as <span className="font-medium">big delta numbers</span> in the Scope / Duration / Delivery boxes above and as a dashed scenario delivery line on the chart.</li>
                    <li><span className="font-medium">Contingency</span> slider overrides the team's configured contingency for the scenario (defaults to the value in the strip above). <span className="font-medium">Capacity</span> scales throughput up or down (−50% to +100%).</li>
                    <li><span className="font-medium">Descope</span> removes <span className="font-medium">whole epics</span> from the plan (by priority tier — Critical is never dropped); <span className="font-medium">Exclude</span> removes individual <span className="font-medium">items</span> (by issue type) from inside every epic that stays.</li>
                    <li>Real epics inherit their Jira priority; set or override it per epic in the Scope table above. Click <span className="font-medium">Reset</span> (top right) to clear all tweaks at once.</li>
                  </ul>
                </div>
              </AppInfoPanel>
              {scenarioDirty && (
                <button type="button" className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 shrink-0" onClick={resetScenario}>Reset</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-xs">
              {/* Contingency */}
              <div className="flex items-center gap-2 py-1">
                <span className="text-gray-700 dark:text-gray-300 whitespace-nowrap w-28">Contingency</span>
                <input
                  value={effectiveContingencyPct}
                  type="range" min={0} max={100} step={5}
                  className="flex-1"
                  title={`Team default: ${team.contingencyPct || 0}%`}
                  onChange={(e) => setScen('contingencyPct', Number(e.target.value))}
                />
                <span className={`font-mono tabular-nums w-12 text-right ${contingencyDirty ? (effectiveContingencyPct < (team.contingencyPct || 0) ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-amber-600 dark:text-amber-400 font-semibold') : 'text-gray-500'}`}>{effectiveContingencyPct}%</span>
              </div>

              {/* Descope */}
              <div className="flex items-center gap-2 py-1 flex-wrap" title="Drop whole epics at the toggled priority tiers">
                <span className="whitespace-nowrap w-28"><span className="text-gray-700 dark:text-gray-300">Descope</span> <span className="text-gray-400 dark:text-gray-500">epics</span></span>
                <div className="flex flex-wrap gap-1">
                  {DROP_TIERS.map((tier) => (
                    <button
                      key={tier} type="button"
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${!isDropped(tier) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-400 line-through dark:bg-slate-800 dark:text-gray-500'}`}
                      title={isDropped(tier) ? `Keep ${tier}-priority epics` : `Drop all ${tier}-priority epics`}
                      onClick={() => toggleDropTier(tier)}
                    >{tier}</button>
                  ))}
                </div>
              </div>

              {/* Capacity */}
              <div className="flex items-center gap-2 py-1">
                <span className="text-gray-700 dark:text-gray-300 whitespace-nowrap w-28">Capacity</span>
                <input
                  value={scenarioOn.extraCapacityPct}
                  type="range" min={-50} max={100} step={5}
                  className="flex-1"
                  onChange={(e) => setScen('extraCapacityPct', Number(e.target.value))}
                />
                <span className={`font-mono tabular-nums w-12 text-right ${scenarioOn.extraCapacityPct ? deltaClass(-scenarioOn.extraCapacityPct) : 'text-gray-700 dark:text-gray-300'}`}>{scenarioOn.extraCapacityPct >= 0 ? '+' : ''}{scenarioOn.extraCapacityPct}%</span>
              </div>

              {/* Exclude */}
              <div className="flex items-center gap-2 py-1 flex-wrap" title="Exclude individual issues of these types from every epic's child count">
                <span className="whitespace-nowrap w-28"><span className="text-gray-700 dark:text-gray-300">Exclude</span> <span className="text-gray-400 dark:text-gray-500">items</span></span>
                <div className="flex flex-wrap gap-1">
                  {EXCLUDE_TYPES.map((type) => (
                    <button
                      key={type} type="button"
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${!isExcluded(type) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-400 line-through dark:bg-slate-800 dark:text-gray-500'}`}
                      title={isExcluded(type) ? `Include ${type}` : `Exclude ${type}`}
                      onClick={() => toggleExcludeType(type)}
                    >{type}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
