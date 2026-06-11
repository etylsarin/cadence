import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarRange, ChevronsLeft, ChevronsRight,
  Trash2, MapPin, FlagTriangleRight, FlagTriangleLeft, CalendarDays, GripVertical,
} from 'lucide-react'
import AppInfoPanel from '@/components/AppInfoPanel'
import AppTooltip from '@/components/AppTooltip'
import { PROJ_COLORS } from '@/lib/tags'
import { formatDate, shortDate, dailyThroughput, countWorkdays, ymd, type SimResult, type PlanRow } from './simulate'
import type { TeamConfig, ReorderChange } from './types'
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
interface ResizeDrag {
  epicId: string
  originalItems: number
  originalWidthPx: number
  pointerX0: number
  frozenPxPerWd: number
  newItems: number
  newWidthPx: number
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
  previewBaseline: SimResult | null
  onStartDateChange: (v: string) => void
  onDragPreview: (change: ReorderChange | null) => void
  onReorder: (change: ReorderChange) => void
  onRemove: (epicKey: string) => void
  onResizeEpic: (epicKey: string, newItems: number) => void
}

export default function PlannerTimeline({
  squad, team, startDate, baseline, previewBaseline,
  onStartDateChange,
  onDragPreview, onReorder, onRemove, onResizeEpic,
}: Props) {
  const [scale, setScale] = useState<Scale>('auto')
  // After a resize commit, hold the drag-time px/wd so the zoom doesn't jump
  // when auto-scale re-fits to the (now shorter) plan.  Cleared when the user
  // explicitly picks a scale or drags the start handle.
  const [lockedPxPerWd, setLockedPxPerWd] = useState<number | null>(null)
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

  const resizeRef = useRef<ResizeDrag | null>(null)
  const [resizeDrag, _setResizeDrag] = useState<ResizeDrag | null>(null)
  const setResize = useCallback((r: ResizeDrag | null) => { resizeRef.current = r; _setResizeDrag(r ? { ...r } : null) }, [])

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
    if (lockedPxPerWd !== null) return lockedPxPerWd
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
    if (squad === 'ALL') return (baseline?.teamPlans || []).flatMap((t) => t.rows)
    const tp = (baseline?.teamPlans || []).find((t) => t.teamId === squad)
    return tp?.rows || []
  }, [baseline, squad])

  const displayRows = useMemo(() => {
    const src = dragState && previewBaseline ? previewBaseline : baseline
    if (squad === 'ALL') return (src?.teamPlans || []).flatMap((t) => t.rows)
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
        color: sorted.length ? (PROJ_COLORS[squad] ?? sorted[0]?.color ?? null) : null,
        rows: sorted,
        isGhost: sorted.length === 0,
      }
    })
  }, [displayRows, squad])

  // ── End / finish markers ─────────────────────────────────────────────────────
  const squadLatestEnd = baselineRows.length ? new Date(Math.max(...baselineRows.map((r) => r.plannedEnd.getTime()))) : null
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
  const baselineActiveWeeks = Math.ceil(baselineActiveWorkdays / 5)

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

  // ── Plan summary ────────────────────────────────────────────────────────────
  const perWorkday = dailyThroughput(team)
  const scopeEpics = baseline?.allRows?.length || 0
  const scopeItems = (baseline?.allRows || []).reduce((s, r) => s + Number(r.items || 0), 0)

  // ── Start-handle drag ───────────────────────────────────────────────────────
  // Stable snapshot of values the window-level pointer handlers need.
  const latest = useRef({ pxPerWorkday, baselineRows, chartOrigin, baselineStartD, barOffset, floorFromOriginWorkday, scale, containerWidth })
  latest.current = { pxPerWorkday, baselineRows, chartOrigin, baselineStartD, barOffset, floorFromOriginWorkday, scale, containerWidth }

  const onStartHandleMove = useCallback((ev: PointerEvent) => {
    const s = startHandleRef.current
    if (!s) return
    const deltaWd = Math.round((ev.clientX - s.clientX0) / Math.max(s.frozenPx, 0.0001))
    const newStart = deltaWd >= 0 ? addWorkdaysSafe(s.baseStart, deltaWd) : subtractWorkdays(s.baseStart, -deltaWd)
    onStartDateChange(ymd(newStart))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStartDateChange])

  const endStartHandle = useCallback(() => {
    setLockedPxPerWd(null)
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

  // ── Right-edge resize ────────────────────────────────────────────────────────
  const onResizeMove = useCallback((ev: PointerEvent) => {
    const s = resizeRef.current
    if (!s) return
    const dx = ev.clientX - s.pointerX0
    const newWidthPx = Math.max(s.frozenPxPerWd, s.originalWidthPx + dx)
    const newDurationWd = Math.max(1, Math.round(newWidthPx / s.frozenPxPerWd))
    const newItems = Math.max(1, Math.round(newDurationWd * dailyThroughput(team)))
    setResize({ ...s, newWidthPx, newItems })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setResize, team])

  const endResizeRef = useRef<() => void>(() => { /* filled below */ })
  const endResize = useCallback(() => {
    const s = resizeRef.current
    if (s && s.newItems !== s.originalItems) {
      onResizeEpic(s.epicId, s.newItems)
      // In auto mode the zoom re-fits after the simulation re-runs (shorter plan
      // → higher zoom → bar appears wider).  Lock the drag-time px/wd so the
      // zoom stays stable until the user explicitly picks a different scale.
      setLockedPxPerWd(s.frozenPxPerWd)
    }
    setResize(null)
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', endResizeRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onResizeMove, onResizeEpic, setResize])
  useEffect(() => { endResizeRef.current = endResize })

  function startResize(ev: ReactPointerEvent, row: PlanRow) {
    if (ev.button !== 0) return
    ev.preventDefault(); ev.stopPropagation()
    const originalWidthPx = barWidth(row)
    setResize({
      epicId: row.epicId,
      originalItems: row.items,
      originalWidthPx,
      pointerX0: ev.clientX,
      frozenPxPerWd: Math.max(0.5, pxPerWorkday),
      newItems: row.items,
      newWidthPx: originalWidthPx,
    })
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', endResizeRef.current)
  }

  // Unmount cleanup.
  useEffect(() => () => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', endDragRef.current)
    window.removeEventListener('pointermove', onStartHandleMove)
    window.removeEventListener('pointerup', endStartHandle)
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', endResizeRef.current)
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
    const isResizing = resizeDrag?.epicId === row.epicId
    const w = isResizing ? resizeDrag!.newWidthPx : barWidth(row)
    const base: CSSProperties = {
      top: `${(LANE_HEIGHT - BAR_HEIGHT) / 2}px`,
      height: `${BAR_HEIGHT}px`,
      left: `${barOffset(row)}px`,
      width: `${w}px`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'flex-start',
      textAlign: 'left',
      padding: '10px 18px 4px 10px',
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
    const isResizing = resizeDrag?.epicId === row.epicId
    return [
      dragState || resizeDrag ? 'pointer-events-none' : 'cursor-grab',
      isResizing ? '' : (dragState ? 'transition-[left,width] duration-150 ease-out' : 'transition-[left,width] duration-200 ease-out'),
      isFrame(row) ? 'z-[3]' : 'z-[1] text-white',
    ].join(' ')
  }

  const draggedPreviewRow = dragState ? displayRows.find((r) => r.epicId === dragState.epicId) || null : null
  const draggedLabelX = draggedPreviewRow ? barOffset(draggedPreviewRow) : null
  const draggedLabelDate = draggedPreviewRow ? formatDropLabel(draggedPreviewRow.plannedStart) : null

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
            <li><span className="font-medium">Pace</span> is the squad's average completed items/month, measured from synced data over the selected timeframe. Because it's measured end-to-end on real deliveries, waits, rework and release queues are already in the rate — an epic's default length is simply its item count at that pace.</li>
            <li><span className="font-medium">Start</span> sets when the plan begins — click the date in the Start box (a calendar picker; past dates are disabled) <em>or</em> drag the green <span className="font-medium">Start</span> handle on the chart to slide the whole plan.</li>
            <li><span className="font-medium">Drag bars horizontally</span> to set when each epic starts. Bars that overlap in time share the squad's daily capacity equally and split into their own swimlanes automatically. <span className="font-medium">Drag a bar off the top or left edge</span> of the chart to remove it from the plan.</li>
            <li><span className="font-medium">Resize bars</span> by hovering the right edge of a bar until the resize cursor appears, then dragging. Dragging right increases the epic's item count (longer bar); dragging left decreases it. Downstream bars in the same lane shift automatically to stay back-to-back.</li>
            <li><span className="font-medium">Auto-ordering</span>: when epics are added from the Scope table, the planner places them in series (same lane) if ticket blocking links require it, and in parallel (separate lanes) otherwise. Manual drag always overrides auto-placement.</li>
            <li><span className="font-medium">Lanes</span> are queues — bars inside the same lane stay back-to-back; bars in different lanes share the squad's daily capacity in parallel.</li>
            <li><span className="font-medium">Scale</span> picks the zoom — Auto fits the plan exactly; Month / Quarter / Year are fixed zoom levels. Every scale has matching scroll room on both sides, so you can scroll back past Start or forward past End.</li>
          </ul>
        </div>
      </AppInfoPanel>

      {/* Data-derived pace (read-only) */}
      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
        Pace: <span className="font-semibold text-gray-900 dark:text-gray-100">{Math.round(team?.throughputPerMonth || 0)} items/mo</span>
        <span className="text-gray-400 dark:text-gray-500"> (≈ {perWorkday.toFixed(2)}/workday — average completed work over the selected timeframe)</span>
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
          <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{scopeItems} <span className="text-base font-normal text-gray-500">items</span></div>
          <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">across {scopeEpics} {scopeEpics === 1 ? 'epic' : 'epics'}</div>
          <div className="text-[11px] mt-0.5 leading-4 min-h-[1rem]" />
        </div>

        {/* Duration */}
        <div className="rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Duration</div>
          <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{baselineActiveWorkdays} <span className="text-base font-normal text-gray-500">workdays</span></div>
          <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">≈ {baselineActiveWeeks} weeks of active work</div>
          <div className="text-[11px] mt-0.5 leading-4 min-h-[1rem]" />
        </div>

        {/* Delivery */}
        <div className="rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Delivery</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">{formatDate(baseline ? baseline.latestEnd : baselineStartD)}</div>
          <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">all work delivered in {daysToDelivery} days</div>
          <div className="text-[11px] mt-0.5 leading-4 min-h-[1rem]" />
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
          {/* Toolbar: scale */}
          <div className="mt-4 flex items-center gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-gray-400">Scale</span>
              <div className="flex gap-0.5 rounded bg-gray-100 dark:bg-slate-800 p-0.5">
                {(['auto', 'month', 'quarter', 'year'] as Scale[]).map((s) => (
                  <button
                    key={s}
                    className={`px-2.5 py-0.5 rounded text-xs font-medium capitalize transition-colors ${scale === s ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
                    onClick={() => { setLockedPxPerWd(null); setScale(s) }}
                  >{s}</button>
                ))}
              </div>
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
                  title="End"
                  className="absolute top-6 z-[8] inline-flex items-center gap-1 text-[10px] font-medium tabular-nums bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded whitespace-nowrap"
                  style={{ left: `${LABEL_COL_PX + finishX}px`, transform: 'translateX(-50%)' }}
                ><FlagTriangleLeft size={11} className="shrink-0" /> {shortDate(squadLatestEnd || baseline.latestEnd)}</div>
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
                      {lane.rows.map((row) => {
                        const isResizingThis = resizeDrag?.epicId === row.epicId
                        const displayItems = isResizingThis ? resizeDrag!.newItems : row.items
                        const displayWd    = isResizingThis ? Math.max(1, Math.round(resizeDrag!.newWidthPx / Math.max(0.5, pxPerWorkday))) : row.durationWorkdays
                        return (
                          <AppTooltip
                            key={row.epicId}
                            placement="top"
                            followCursor
                            disabled={!!dragState || !!resizeDrag}
                            className={`absolute rounded text-[10px] font-semibold select-none overflow-hidden ${barClass(row)}`}
                            style={barStyle(row)}
                            data-epic-id={row.epicId}
                            onPointerDown={(e) => { if (!resizeDrag) startDrag(e, row, lane.key) }}
                            content={
                              <div className="min-w-[200px]">
                                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{row.durationWorkdays} workdays</div>
                                <div className="text-[11px] text-gray-500 tabular-nums">{shortDate(row.plannedStart)} → {shortDate(row.plannedEnd)}</div>
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
                              {displayItems} items · {displayWd} wd{row.priorityLevel ? <> · {row.priorityLevel}</> : null}
                            </div>
                            {/* Right-edge resize handle — always present, pointer-events restored */}
                            {!dragState && (
                              <div
                                className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-[4] flex items-center justify-end pr-0.5 opacity-0 hover:opacity-100 pointer-events-auto"
                                title="Drag to resize"
                                onPointerDown={(e) => startResize(e, row)}
                              >
                                <div className="w-0.5 h-4 rounded-full bg-white/60" />
                              </div>
                            )}
                          </AppTooltip>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
