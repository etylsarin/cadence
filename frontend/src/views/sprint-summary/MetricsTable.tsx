import { useState } from 'react'
import TagBadge from '@/components/TagBadge'
import type { SummaryRows, MetricRow } from './types'

function fmt(n: number | null | undefined): string {
  if (n == null) return ''
  return Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(1)
}
function pct(part: number, total: number): string {
  if (!total || !part) return ''
  return ` (${Math.round((part / total) * 100)}%)`
}

const ROWS: [keyof SummaryRows, string][] = [['planned', 'Planned'], ['injected', 'Injected'], ['total', 'Total']]

export default function MetricsTable({ rows }: { rows: SummaryRows }) {
  const [byPoints, setByPoints] = useState(false)

  const cellValue = (r: MetricRow) => (byPoints ? fmt(r.points) : r.count)

  return (
    <div>
      {/* Toggle */}
      <div className="flex justify-end mb-2">
        <div className="inline-flex rounded border border-gray-200 dark:border-slate-600 text-xs overflow-hidden">
          <button
            className={`px-3 py-1 transition-colors ${!byPoints ? 'bg-gray-900 dark:bg-slate-600 text-white dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
            onClick={() => setByPoints(false)}
          >Items</button>
          <button
            className={`px-3 py-1 transition-colors border-l border-gray-200 dark:border-slate-600 ${byPoints ? 'bg-gray-900 dark:bg-slate-600 text-white dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
            onClick={() => setByPoints(true)}
          >Story Points</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
              <th className="px-4 py-3 text-left font-medium w-28" />
              <th className="px-4 py-3 text-center font-medium">Total</th>
              <th className="px-4 py-3 text-center font-medium">Delivered</th>
              <th className="px-4 py-3 text-center font-medium">Approved<br /><span className="font-normal text-[10px]">for PROD env</span></th>
              <th className="px-4 py-3 text-center font-medium">Completed<br /><span className="font-normal text-[10px]">delivered + approved</span></th>
              <th className="px-4 py-3 text-center font-medium">Not Done</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([rowKey, label]) => {
              const r = rows[rowKey]
              const notDone = byPoints ? r.points - r.completed.points : r.count - r.completed.count
              return (
                <tr key={rowKey} className={`border-b border-gray-50 dark:border-slate-700 last:border-0 ${rowKey === 'total' ? 'bg-gray-50/50 dark:bg-slate-800/50 font-medium' : ''}`}>
                  <td className="px-4 py-3">
                    {rowKey !== 'total' ? <TagBadge kind="scope" value={rowKey} /> : <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Total</span>}
                  </td>

                  {/* Total */}
                  <td className="px-4 py-3 text-center">
                    {r.available !== false ? (
                      <>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{cellValue(r)}</span>
                        {byPoints && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">SP</span>}
                        {rowKey === 'total' && rows.injected.available !== false && (
                          <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {byPoints ? pct(rows.injected.points, rows.total.points) : pct(rows.injected.count, rows.total.count)} injected
                          </span>
                        )}
                      </>
                    ) : <span className="text-xs text-gray-300 dark:text-gray-600 italic">N/A</span>}
                  </td>

                  {/* Delivered / Approved / Completed */}
                  {(['delivered', 'approved', 'completed'] as const).map((cell) => (
                    <td key={cell} className="px-4 py-3 text-center">
                      {r.available !== false ? (
                        <>
                          <span className="font-semibold text-gray-800 dark:text-gray-200">{byPoints ? fmt(r[cell].points) : r[cell].count}</span>
                          {byPoints && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">SP</span>}
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {byPoints ? pct(r[cell].points, r.points) : pct(r[cell].count, r.count)}
                          </span>
                        </>
                      ) : <span className="text-xs text-gray-300 dark:text-gray-600 italic">N/A</span>}
                    </td>
                  ))}

                  {/* Not Done */}
                  <td className="px-4 py-3 text-center">
                    {r.available !== false ? (
                      <>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{byPoints ? fmt(notDone) : notDone}</span>
                        {byPoints && <span className="text-xs text-gray-400 ml-1">SP</span>}
                        <span className="text-xs text-gray-400 dark:text-gray-500">{pct(notDone, byPoints ? r.points : r.count)}</span>
                      </>
                    ) : <span className="text-xs text-gray-300 dark:text-gray-600 italic">N/A</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
