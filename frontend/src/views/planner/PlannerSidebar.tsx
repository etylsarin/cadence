import { useEffect, useRef } from 'react'
import { CalendarRange } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import SquadSelector from '@/components/SquadSelector'
import TimeframePicker, { type TimeframePickerHandle } from '@/components/TimeframePicker'
import type { PeriodSelection } from '@/lib/jql'

interface Props {
  squad: string
  squads: string[]
  asOf?: string | null
  monthsUsed?: number
  monthsExcluded?: number
  onSquadChange: (s: string) => void
  onPeriodChange: (p: PeriodSelection) => void
}

export default function PlannerSidebar({ squad, squads, asOf = null, monthsUsed = 0, monthsExcluded = 0, onSquadChange, onPeriodChange }: Props) {
  const pickerRef = useRef<TimeframePickerHandle>(null)

  // Hydrate the picker's earliest-year from the same range the metrics gold
  // covers, so the picker offers the full depth of history.
  useEffect(() => {
    fetch('/metrics/api/date-range')
      .then((r) => r.json())
      .then(({ start_date }) => {
        if (start_date && pickerRef.current) pickerRef.current.setStartYear(parseInt(start_date.slice(0, 4), 10))
      })
      .catch(() => { /* non-fatal */ })
  }, [])

  return (
    <AppSidebar
      title="Epic Planner"
      icon={CalendarRange}
      header={<SquadSelector value={squad} squads={squads} onChange={onSquadChange} />}
    >
      {/* Timeframe — drives the data-derived delivery pace. */}
      <div className="px-2 pt-3 pb-1">
        <div className="px-1 mb-2 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
          Pick a timeframe to measure the squad's <span className="font-medium text-gray-700 dark:text-gray-300">delivery pace</span> (average completed items/month) from. Only completed months are counted.
        </div>
        <TimeframePicker ref={pickerRef} onChange={onPeriodChange} />
        <div className="mt-5 px-1 text-[10px] text-gray-400 leading-snug">
          {monthsUsed > 0
            ? <>{monthsUsed} {monthsUsed === 1 ? 'month' : 'months'} in scope · latest {asOf}</>
            : <>No complete months in scope — pick a past period</>}
          {monthsExcluded > 0 && (
            <div className="text-amber-600 dark:text-amber-500" title="Months without complete data are skipped from the pace average.">
              {monthsExcluded} {monthsExcluded === 1 ? 'month' : 'months'} skipped (incomplete / future)
            </div>
          )}
        </div>
      </div>
    </AppSidebar>
  )
}
