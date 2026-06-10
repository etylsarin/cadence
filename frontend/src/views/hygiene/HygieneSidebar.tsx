import { ClipboardCheck } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import AppCheckbox from '@/components/AppCheckbox'
import SquadSelector from '@/components/SquadSelector'
import type { RuleResult } from './types'

interface Props {
  squad: string
  squads: string[]
  rules: RuleResult[]
  hiddenRules: Set<string>
  onSquadChange: (s: string) => void
  onToggleRule: (id: string, visible: boolean) => void
}

export default function HygieneSidebar({ squad, squads, rules, hiddenRules, onSquadChange, onToggleRule }: Props) {
  return (
    <AppSidebar
      title="Hygiene Auditor"
      icon={ClipboardCheck}
      header={<SquadSelector value={squad} squads={squads} onChange={onSquadChange} />}
    >
      <div className="px-2 pt-3 pb-1">
        <div className="px-1 mb-2 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
          Every ticket in the synced mirror is checked against the rules below.
          Violations silently corrupt <span className="font-medium text-gray-700 dark:text-gray-300">velocity, flow and release metrics</span>.
        </div>

        {rules.length > 0 && (
          <div className="mt-4 px-1">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Rules</div>
            <div className="flex flex-col gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              {rules.map((r) => (
                <AppCheckbox key={r.id} checked={!hiddenRules.has(r.id)} onChange={(c) => onToggleRule(r.id, c)}>
                  <span className="flex items-center gap-1.5">
                    {r.label}
                    <span className={`text-[10px] px-1 rounded ${r.count ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-gray-500'}`}>{r.count}</span>
                  </span>
                </AppCheckbox>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppSidebar>
  )
}
