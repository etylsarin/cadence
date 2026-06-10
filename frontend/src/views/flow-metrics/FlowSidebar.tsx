import { useEffect, useRef } from 'react'
import { Activity } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import AppCheckbox from '@/components/AppCheckbox'
import SquadSelector from '@/components/SquadSelector'
import TimeframePicker, { type TimeframePickerHandle } from '@/components/TimeframePicker'
import type { PeriodSelection } from '@/lib/jql'

// The flow gold only includes the issue types that go through the full
// dev-to-release workflow (see the Sync flow_metrics transformation).
export const FLOW_TYPES = ['Story', 'Bug']

interface Props {
  squad: string
  squads: string[]
  types: string[]
  monthsUsed?: number
  onSquadChange: (s: string) => void
  onTypesChange: (types: string[]) => void
  onPeriodChange: (p: PeriodSelection) => void
}

export default function FlowSidebar({ squad, squads, types, monthsUsed = 0, onSquadChange, onTypesChange, onPeriodChange }: Props) {
  const pickerRef = useRef<TimeframePickerHandle>(null)

  // Hydrate the picker's earliest-year from the range the flow gold covers,
  // so the picker offers the full depth of history.
  useEffect(() => {
    fetch('/flow-metrics/api/date-range')
      .then((r) => r.json())
      .then(({ start_date }) => {
        if (start_date && pickerRef.current) pickerRef.current.setStartYear(parseInt(start_date.slice(0, 4), 10))
      })
      .catch(() => { /* non-fatal */ })
  }, [])

  function toggleType(t: string, checked: boolean) {
    const next = checked ? [...types, t] : types.filter((x) => x !== t)
    if (next.length) onTypesChange(next)   // never let the user clear all types
  }

  return (
    <AppSidebar
      title="Flow Metrics"
      icon={Activity}
      header={<SquadSelector value={squad} squads={squads} onChange={onSquadChange} />}
    >
      <div className="px-2 pt-3 pb-1">
        <div className="px-1 mb-2 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
          Pick the completion months to analyse. Cycle and lead times come from items
          <span className="font-medium text-gray-700 dark:text-gray-300"> completed</span> in the timeframe.
        </div>
        <TimeframePicker ref={pickerRef} onChange={onPeriodChange} />

        <div className="mt-5 px-1">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Issue types</div>
          <div className="flex flex-col gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            {FLOW_TYPES.map((t) => (
              <AppCheckbox key={t} checked={types.includes(t)} onChange={(c) => toggleType(t, c)}>{t}</AppCheckbox>
            ))}
          </div>
        </div>

        <div className="mt-5 px-1 text-[10px] text-gray-400 leading-snug">
          {monthsUsed > 0
            ? <>{monthsUsed} {monthsUsed === 1 ? 'month' : 'months'} in scope</>
            : <>No months in scope — pick a period</>}
        </div>
      </div>
    </AppSidebar>
  )
}
