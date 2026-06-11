import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { PeriodSelection } from '@/lib/jql'

/**
 * Single-period timeframe picker — Year / Quarter / Month columns with a
 * multi-select toggle. Emits the same `{ gran, years, periods }` payload Flow
 * Metrics produces, so backends accepting that shape can be reused.
 *
 * Imperative handle (getState/setState/setStartYear) supports MetricsSidebar's
 * "swap A ↔ B" affordance — see useImperativeHandle below.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const COLS = ['year', 'quarter', 'month'] as const
type Col = (typeof COLS)[number]

const today      = new Date()
const THIS_YEAR  = today.getFullYear()
const THIS_MONTH = today.getMonth()
const THIS_Q     = Math.floor(THIS_MONTH / 3)

// Default month selection = the last fully-completed calendar month (the
// current month is mid-flight and would bias the first read). Wrap to Dec of
// the previous year when today is January.
const LAST_COMPLETE_MONTH_Y = THIS_MONTH === 0 ? THIS_YEAR - 1 : THIS_YEAR
const LAST_COMPLETE_MONTH_M = THIS_MONTH === 0 ? 11 : THIS_MONTH - 1

interface YearItem    { key: number; year: number; label: string }
interface PeriodItem  { key: string; year: number; label: string }

function buildYearList(startYear: number): YearItem[] {
  const out: YearItem[] = []
  for (let y = THIS_YEAR; y >= startYear; y--) out.push({ key: y, year: y, label: String(y) })
  return out
}
function buildQuarterList(startYear: number): PeriodItem[] {
  const out: PeriodItem[] = []
  for (let y = THIS_YEAR; y >= startYear; y--)
    for (let q = (y === THIS_YEAR ? THIS_Q : 3); q >= 0; q--)
      out.push({ key: `${y}-Q${q + 1}`, year: y, label: `${y} Q${q + 1}` })
  return out
}
function buildMonthList(startYear: number): PeriodItem[] {
  const out: PeriodItem[] = []
  for (let y = THIS_YEAR; y >= startYear; y--)
    for (let m = (y === THIS_YEAR ? THIS_MONTH : 11); m >= 0; m--)
      out.push({ key: `${y}-${m}`, year: y, label: `${y} ${MONTH_NAMES[m]}` })
  return out
}

export interface TimeframeState {
  activeCol: Col
  multi: boolean
  years: Set<number>
  qtrs: Set<string>
  months: Set<string>
}

export interface TimeframePickerHandle {
  setStartYear: (y: number) => void
  getState: () => TimeframeState
  setState: (s: Partial<TimeframeState>) => void
}

interface Props {
  startYear?: number
  initialGran?: Col
  /** Start with multi-select enabled so the user can pick several periods immediately. */
  initialMulti?: boolean
  keyboardNav?: boolean
  /** Vue's `#actions` slot — inline buttons in the header row (e.g. A/B swap). */
  actions?: ReactNode
  onChange?: (period: PeriodSelection) => void
}

const TimeframePicker = forwardRef<TimeframePickerHandle, Props>(function TimeframePicker(
  { startYear: startYearProp = new Date().getFullYear() - 2, initialGran = 'month', initialMulti = false, keyboardNav = true, actions, onChange },
  ref,
) {
  const [startYear, setStartYear]   = useState(startYearProp)
  const [multiSelect, setMultiSelect] = useState(initialMulti)
  const [activeCol, setActiveCol]   = useState<Col>(initialGran)
  const [selYears, setSelYears]     = useState<Set<number>>(() => new Set([THIS_YEAR]))
  const [selQtrs, setSelQtrs]       = useState<Set<string>>(() => new Set([`${THIS_YEAR}-Q${THIS_Q + 1}`]))
  const [selMonths, setSelMonths]   = useState<Set<string>>(() => new Set([`${LAST_COMPLETE_MONTH_Y}-${LAST_COMPLETE_MONTH_M}`]))

  const yearScrollEl  = useRef<HTMLDivElement>(null)
  const qtrScrollEl   = useRef<HTMLDivElement>(null)
  const monthScrollEl = useRef<HTMLDivElement>(null)

  const yearList    = useMemo(() => buildYearList(startYear), [startYear])
  const quarterList = useMemo(() => buildQuarterList(startYear), [startYear])
  const monthList   = useMemo(() => buildMonthList(startYear), [startYear])

  // ── Period payload + change emission ───────────────────────────────────────
  const buildPeriod = useCallback((): PeriodSelection => {
    const gran = activeCol === 'year' ? 'Y' : activeCol === 'quarter' ? 'Q' : 'M'
    if (gran === 'Y') return { gran, years: [...selYears].sort((a, b) => a - b), periods: [] }
    if (gran === 'Q') {
      const items = [...selQtrs].map((k) => { const [y, q] = k.split('-'); return { year: +y, q } })
      return { gran, years: [...new Set(items.map((i) => i.year))].sort((a, b) => a - b), periods: [...new Set(items.map((i) => i.q))] }
    }
    const items = [...selMonths].map((k) => { const [y, m] = k.split('-'); return { year: +y, month: MONTH_NAMES[+m] } })
    return { gran, years: [...new Set(items.map((i) => i.year))].sort((a, b) => a - b), periods: [...new Set(items.map((i) => i.month))] }
  }, [activeCol, selYears, selQtrs, selMonths])

  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  // Emit on mount and whenever the active column or selection changes.
  useEffect(() => { onChangeRef.current?.(buildPeriod()) }, [buildPeriod])

  function toggleSet<T>(s: Set<T>, key: T): Set<T> {
    if (!multiSelect) return new Set([key])
    if (s.has(key)) {
      if (s.size === 1) return s    // never let the user clear the selection entirely
      const n = new Set(s); n.delete(key); return n
    }
    return new Set([...s, key])
  }

  // When the user switches to a different column, always start fresh with just
  // the clicked item — don't carry over a prior multi-selection from that col.
  const clickYear  = (item: YearItem)   => {
    const switching = activeCol !== 'year'
    setActiveCol('year')
    setSelYears(switching ? new Set([item.year]) : (s) => toggleSet(s, item.year))
  }
  const clickQtr   = (item: PeriodItem) => {
    const switching = activeCol !== 'quarter'
    setActiveCol('quarter')
    setSelQtrs(switching ? new Set([item.key]) : (s) => toggleSet(s, item.key))
  }
  const clickMonth = (item: PeriodItem) => {
    const switching = activeCol !== 'month'
    setActiveCol('month')
    setSelMonths(switching ? new Set([item.key]) : (s) => toggleSet(s, item.key))
  }

  // ── Keyboard nav (optional) ─────────────────────────────────────────────────
  const latest = useRef({ activeCol, selYears, selQtrs, selMonths, startYear })
  useEffect(() => { latest.current = { activeCol, selYears, selQtrs, selMonths, startYear } })

  const scrollToSelected = useCallback((col: Col) => {
    const el = col === 'year' ? yearScrollEl.current : col === 'quarter' ? qtrScrollEl.current : monthScrollEl.current
    el?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [])

  const handleKeydown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    e.preventDefault()
    setMultiSelect(false)
    const st = latest.current
    const col = st.activeCol
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const idx = COLS.indexOf(col)
      const newIdx = e.key === 'ArrowLeft' ? Math.max(0, idx - 1) : Math.min(2, idx + 1)
      if (newIdx === idx) return
      const nc = COLS[newIdx]
      setActiveCol(nc)
      requestAnimationFrame(() => scrollToSelected(nc))
      return
    }
    const list   = col === 'year' ? buildYearList(st.startYear) : col === 'quarter' ? buildQuarterList(st.startYear) : buildMonthList(st.startYear)
    const selSet = (col === 'year' ? st.selYears : col === 'quarter' ? st.selQtrs : st.selMonths) as Set<number | string>
    const keyOf  = (item: YearItem | PeriodItem) => (col === 'year' ? (item as YearItem).year : item.key)
    let idx = list.findIndex((item) => selSet.has(keyOf(item)))
    if (idx === -1) idx = 0
    const newIdx = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(list.length - 1, idx + 1)
    if (newIdx === idx) return
    const newItem = list[newIdx]
    if (col === 'year')    setSelYears(new Set([(newItem as YearItem).year]))
    if (col === 'quarter') setSelQtrs(new Set([newItem.key as string]))
    if (col === 'month')   setSelMonths(new Set([newItem.key as string]))
    requestAnimationFrame(() => scrollToSelected(col))
  }, [scrollToSelected])

  useEffect(() => {
    if (!keyboardNav) return
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [keyboardNav, handleKeydown])

  // ── Per-column "is the bottom in view?" tracking (drops the fade mask) ───────
  const [atEnd, setAtEnd] = useState({ year: true, quarter: true, month: true })
  const refreshAtEnd = useCallback(() => {
    const check = (el: HTMLDivElement | null) => !el || (el.scrollHeight - el.scrollTop - el.clientHeight <= 1)
    setAtEnd({ year: check(yearScrollEl.current), quarter: check(qtrScrollEl.current), month: check(monthScrollEl.current) })
  }, [])

  useEffect(() => {
    const els = [yearScrollEl.current, qtrScrollEl.current, monthScrollEl.current]
    const observers: ResizeObserver[] = []
    for (const el of els) {
      if (!el) continue
      el.addEventListener('scroll', refreshAtEnd, { passive: true })
      const ro = new ResizeObserver(refreshAtEnd); ro.observe(el); observers.push(ro)
    }
    refreshAtEnd()
    return () => {
      for (const el of els) el?.removeEventListener('scroll', refreshAtEnd)
      observers.forEach((o) => o.disconnect())
    }
  }, [refreshAtEnd])

  // Re-check when list contents shift (startYear hydrating can add rows).
  useEffect(() => { requestAnimationFrame(refreshAtEnd) }, [yearList, quarterList, monthList, refreshAtEnd])

  useImperativeHandle(ref, () => ({
    setStartYear: (y: number) => setStartYear(y),
    getState: () => ({ activeCol, multi: multiSelect, years: new Set(selYears), qtrs: new Set(selQtrs), months: new Set(selMonths) }),
    setState: (s) => {
      if (!s) return
      if (s.activeCol) setActiveCol(s.activeCol)
      if (s.multi != null) setMultiSelect(!!s.multi)
      if (s.years) setSelYears(new Set(s.years))
      if (s.qtrs) setSelQtrs(new Set(s.qtrs))
      if (s.months) setSelMonths(new Set(s.months))
    },
  }), [activeCol, multiSelect, selYears, selQtrs, selMonths])

  const colHead = (col: Col, label: string) => (
    <div
      className={`text-xs text-center mb-1 pb-0.5 border-b transition-colors ${
        activeCol === col ? 'text-gray-700 dark:text-gray-300 border-gray-400 dark:border-slate-500' : 'text-gray-400 border-gray-100 dark:border-slate-700'
      }`}
    >{label}</div>
  )

  const itemBtnClass = (active: boolean) =>
    `text-center py-0.5 rounded text-xs leading-tight transition-colors ${
      active ? 'bg-gray-900 dark:bg-slate-600 text-white dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:bg-sidebar-hover'
    }`

  return (
    <div>
      <div className="flex items-center gap-1 mb-2 px-1">
        <div className="text-[10px] text-gray-400 uppercase tracking-wide flex-1">Timeframe</div>
        {actions}
        <button
          className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
            multiSelect ? 'bg-gray-900 dark:bg-slate-600 text-white dark:text-gray-100' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
          }`}
          onClick={() => {
            if (multiSelect) {
              // Collapse the active column's selection to the most-recent item
              // (lists are newest-first, so the first hit in list order is most recent).
              if (activeCol === 'year') setSelYears(s => s.size > 1 ? new Set([yearList.find(i => s.has(i.year))?.year ?? [...s][0]]) : s)
              else if (activeCol === 'quarter') setSelQtrs(s => s.size > 1 ? new Set([quarterList.find(i => s.has(i.key))?.key ?? [...s][0]]) : s)
              else setSelMonths(s => s.size > 1 ? new Set([monthList.find(i => s.has(i.key))?.key ?? [...s][0]]) : s)
            }
            setMultiSelect(v => !v)
          }}
        >multi</button>
      </div>

      <div className="flex gap-1">
        {/* Year */}
        <div className="flex flex-col w-14 flex-shrink-0">
          {colHead('year', 'Year')}
          <div ref={yearScrollEl} className={`col-scroll flex flex-col gap-px ${atEnd.year ? 'at-end' : ''}`}>
            {yearList.map((item) => {
              const active = selYears.has(item.year) && activeCol === 'year'
              return (
                <button key={item.key} data-active={active ? 'true' : 'false'} className={itemBtnClass(active)} onClick={() => clickYear(item)}>{item.label}</button>
              )
            })}
          </div>
        </div>

        {/* Quarter */}
        <div className="flex flex-col flex-1 min-w-0">
          {colHead('quarter', 'Qtr')}
          <div ref={qtrScrollEl} className={`col-scroll flex flex-col gap-px ${atEnd.quarter ? 'at-end' : ''}`}>
            {quarterList.map((item) => {
              const active = selQtrs.has(item.key) && activeCol === 'quarter'
              return (
                <button key={item.key} data-active={active ? 'true' : 'false'} className={`w-full ${itemBtnClass(active)}`} onClick={() => clickQtr(item)}>{item.label}</button>
              )
            })}
          </div>
        </div>

        {/* Month */}
        <div className="flex flex-col flex-1 min-w-0">
          {colHead('month', 'Month')}
          <div ref={monthScrollEl} className={`col-scroll flex flex-col gap-px ${atEnd.month ? 'at-end' : ''}`}>
            {monthList.map((item) => {
              const active = selMonths.has(item.key) && activeCol === 'month'
              return (
                <button key={item.key} data-active={active ? 'true' : 'false'} className={`w-full ${itemBtnClass(active)}`} onClick={() => clickMonth(item)}>{item.label}</button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
})

export default TimeframePicker
