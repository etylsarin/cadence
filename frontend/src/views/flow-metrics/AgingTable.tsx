import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import TagBadge from '@/components/TagBadge'
import type { AgingData, AgingItem } from './types'

function fmtDays(d: number | null): string {
  return d == null ? '—' : d.toFixed(1)
}

type SortKey = 'key' | 'type' | 'points' | 'summary' | 'status' | 'in_status_days' | 'age_days'
type SortDir = 'asc' | 'desc'

function naturalKey(key: string): [string, number] {
  const i = key.lastIndexOf('-')
  if (i < 0) return [key, 0]
  const num = parseInt(key.slice(i + 1), 10)
  return [key.slice(0, i), isNaN(num) ? 0 : num]
}

function compare(a: AgingItem, b: AgingItem, key: SortKey, dir: SortDir): number {
  let diff = 0
  if (key === 'key') {
    const [ap, an] = naturalKey(a.key)
    const [bp, bn] = naturalKey(b.key)
    diff = ap < bp ? -1 : ap > bp ? 1 : an - bn
  } else if (key === 'points' || key === 'in_status_days' || key === 'age_days') {
    diff = (a[key] ?? -1) - (b[key] ?? -1)
  } else {
    const av = (a[key] ?? '') as string
    const bv = (b[key] ?? '') as string
    diff = av < bv ? -1 : av > bv ? 1 : 0
  }
  return dir === 'asc' ? diff : -diff
}

interface ColDef { key: SortKey; label: string; className?: string }

const COLUMNS: ColDef[] = [
  { key: 'key',            label: 'Key',       className: 'whitespace-nowrap w-px' },
  { key: 'type',           label: 'Type',      className: 'w-px' },
  { key: 'points',         label: 'SP',        className: 'text-right w-px' },
  { key: 'summary',        label: 'Summary',   className: 'w-full' },
  { key: 'status',         label: 'Status',    className: 'w-px' },
  { key: 'in_status_days', label: 'In status', className: 'text-right whitespace-nowrap w-px' },
  { key: 'age_days',       label: 'Age',       className: 'text-right whitespace-nowrap w-px' },
]

interface Props {
  data: AgingData
}

export default function AgingTable({ data }: Props) {
  const { items, lead_p85: p85, jira_url: jiraUrl } = data
  const [sortKey, setSortKey] = useState<SortKey>('age_days')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'points' || key === 'in_status_days' || key === 'age_days' ? 'desc' : 'asc')
    }
  }

  const sorted = useMemo(
    () => [...items].sort((a, b) => compare(a, b, sortKey, sortDir)),
    [items, sortKey, sortDir],
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="text-gray-900 dark:text-gray-100 font-semibold">{items.length} items in progress</span>
        {p85 != null && (
          <span>· historic P85 lead time <span className="font-medium text-gray-700 dark:text-gray-300">{p85.toFixed(1)}d</span></span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
              {COLUMNS.map((col) => {
                const active = sortKey === col.key
                const isRight = col.key === 'points' || col.key === 'in_status_days' || col.key === 'age_days'
                return (
                  <th
                    key={col.key}
                    className={`px-3 py-2 font-medium select-none cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-colors ${col.className ?? ''}`}
                    onClick={() => handleSort(col.key)}
                  >
                    <span className={`inline-flex items-center gap-1 ${isRight ? 'flex-row-reverse' : ''}`}>
                      {col.label}
                      {col.key === 'in_status_days' && <span className="font-normal text-[10px]">days</span>}
                      {col.key === 'age_days' && <span className="font-normal text-[10px]">days</span>}
                      {active ? (
                        sortDir === 'asc'
                          ? <ChevronUp size={11} className="text-gray-700 dark:text-gray-300 shrink-0" />
                          : <ChevronDown size={11} className="text-gray-700 dark:text-gray-300 shrink-0" />
                      ) : (
                        <ChevronsUpDown size={11} className="text-gray-300 dark:text-gray-600 shrink-0" />
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {!sorted.length ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 text-xs">No started work in progress — nothing is aging.</td></tr>
            ) : (
              sorted.map((i) => {
                const overdue = p85 != null && i.age_days != null && i.age_days > p85
                return (
                  <tr key={i.key} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {jiraUrl
                        ? <a href={`${jiraUrl}/browse/${i.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline">{i.key}</a>
                        : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i.key}</span>}
                    </td>
                    <td className="px-3 py-2"><TagBadge kind="type" value={i.type} iconOnly /></td>
                    <td className="px-3 py-2 text-right text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{i.points ?? ''}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{i.summary}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><TagBadge kind="status" value={i.status} /></td>
                    <td className="px-3 py-2 text-right text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDays(i.in_status_days)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className={`text-xs ${overdue ? 'font-semibold text-amber-600 dark:text-amber-500' : 'text-gray-700 dark:text-gray-300'}`}>{fmtDays(i.age_days)}</span>
                      {overdue && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" title={`Older than the historic P85 lead time (${p85?.toFixed(1)}d, created → done)`}>&gt; P85</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
