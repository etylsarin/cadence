import type { StageStat } from './types'

const KIND_LABEL: Record<StageStat['kind'], string> = { active: 'Active', wait: 'Wait', queue: 'Queue' }
const KIND_BAR: Record<StageStat['kind'], string> = {
  active: 'bg-gray-800 dark:bg-slate-400',
  wait:   'bg-amber-400 dark:bg-amber-500',
  queue:  'bg-gray-300 dark:bg-slate-600',
}
const KIND_BADGE: Record<StageStat['kind'], string> = {
  active: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300',
  wait:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  queue:  'bg-gray-50 text-gray-400 dark:bg-slate-800 dark:text-gray-500',
}

function fmtDays(d: number | null): string {
  return d == null ? '—' : d.toFixed(1)
}

interface Props {
  stages: StageStat[]
  onStageClick?: (stage: StageStat) => void
}

/** "Where time goes" — average days per workflow stage with a share bar.
 *  Share = the stage's portion of total lead time across all completed items. */
export default function StageTable({ stages, onStageClick }: Props) {
  const maxShare = Math.max(...stages.map((s) => s.share), 0.001)

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
            <th className="px-4 py-3 text-left font-medium">Stage</th>
            <th className="px-4 py-3 text-left font-medium w-1/3">Share of lead time</th>
            <th className="px-4 py-3 text-right font-medium">Avg<span className="font-normal text-[10px] ml-1">days</span></th>
            <th className="px-4 py-3 text-right font-medium">P50</th>
            <th className="px-4 py-3 text-right font-medium">P85</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr
              key={s.stage}
              className={`border-b border-gray-50 dark:border-slate-700 last:border-0 transition-colors ${onStageClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800' : ''}`}
              onClick={() => onStageClick?.(s)}
              title={onStageClick ? `Show items by time in ${s.label}` : undefined}
            >
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="text-xs text-gray-700 dark:text-gray-300 mr-2">{s.label}</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${KIND_BADGE[s.kind]}`}>{KIND_LABEL[s.kind]}</span>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded bg-gray-100 dark:bg-slate-800 overflow-hidden">
                    <div className={`h-full rounded ${KIND_BAR[s.kind]}`} style={{ width: `${(s.share / maxShare) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 w-8 text-right">{Math.round(s.share * 100)}%</span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-800 dark:text-gray-200">{fmtDays(s.avg)}</td>
              <td className="px-4 py-2.5 text-right text-xs text-gray-500 dark:text-gray-400">{fmtDays(s.p50)}</td>
              <td className="px-4 py-2.5 text-right text-xs text-gray-500 dark:text-gray-400">{fmtDays(s.p85)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
