import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import TagBadge from '@/components/TagBadge'
import type { FindingRow } from './types'

function fmt(n: number | null | undefined): string {
  if (n == null) return ''
  return Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(1)
}

type SortKey = 'key' | 'type' | 'points' | 'summary' | 'status' | 'rule' | 'date' | 'detail'
type SortDir = 'asc' | 'desc'

function naturalKey(key: string): [string, number] {
  const i = key.lastIndexOf('-')
  if (i < 0) return [key, 0]
  const num = parseInt(key.slice(i + 1), 10)
  return [key.slice(0, i), isNaN(num) ? 0 : num]
}

function compare(a: FindingRow, b: FindingRow, key: SortKey, dir: SortDir): number {
  let diff = 0
  if (key === 'key') {
    const [ap, an] = naturalKey(a.key)
    const [bp, bn] = naturalKey(b.key)
    diff = ap < bp ? -1 : ap > bp ? 1 : an - bn
  } else if (key === 'points') {
    diff = (a.points ?? -1) - (b.points ?? -1)
  } else {
    const av = (a[key] ?? '') as string
    const bv = (b[key] ?? '') as string
    diff = av < bv ? -1 : av > bv ? 1 : 0
  }
  return dir === 'asc' ? diff : -diff
}

interface ColDef { key: SortKey; label: string; className?: string }

const COLUMNS: ColDef[] = [
  { key: 'key',    label: 'Key',     className: 'whitespace-nowrap w-px' },
  { key: 'type',   label: 'Type',    className: 'w-px' },
  { key: 'points', label: 'SP',      className: 'text-right w-px' },
  { key: 'summary',label: 'Summary', className: 'w-full' },
  { key: 'status', label: 'Status',  className: 'whitespace-nowrap w-px' },
  { key: 'rule',   label: 'Rule',    className: 'whitespace-nowrap w-px' },
  { key: 'date',   label: 'Date',    className: 'whitespace-nowrap w-px' },
  { key: 'detail', label: 'Finding', className: 'whitespace-nowrap' },
]

interface Props {
  rows: FindingRow[]
  jiraUrl?: string
}

export default function FindingsTable({ rows, jiraUrl = '' }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'date' || key === 'points' ? 'desc' : 'asc')
    }
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compare(a, b, sortKey, sortDir)),
    [rows, sortKey, sortDir],
  )

  if (!rows.length) return null

  return (
    <div className="overflow-y-auto max-h-[600px] rounded-lg border border-gray-100 dark:border-slate-700">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-50 dark:bg-slate-800 text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
            {COLUMNS.map((col) => {
              const active = sortKey === col.key
              return (
                <th
                  key={col.key}
                  className={`px-3 py-2 font-medium select-none cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-colors ${col.className ?? ''}`}
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
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
          {sorted.map((i, idx) => (
            <tr key={`${i.ruleId}:${i.key}:${idx}`} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
              <td className="px-3 py-2 whitespace-nowrap">
                {jiraUrl
                  ? <a href={`${jiraUrl}/browse/${i.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline">{i.key}</a>
                  : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i.key}</span>}
              </td>
              <td className="px-3 py-2"><TagBadge kind="type" value={i.type} iconOnly /></td>
              <td className="px-3 py-2 text-right text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmt(i.points)}</td>
              <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{i.summary}</td>
              <td className="px-3 py-2 whitespace-nowrap"><TagBadge kind="status" value={i.status} /></td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 font-medium">{i.rule}</span>
              </td>
              <td className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{i.date ?? ''}</td>
              <td className="px-3 py-2 text-xs text-amber-700 dark:text-amber-500 whitespace-nowrap">{i.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
