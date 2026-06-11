import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import TagBadge from '@/components/TagBadge'
import type { RnIssue } from './types'

type SortKey = 'key' | 'type' | 'priority' | 'summary' | 'status'
type SortDir = 'asc' | 'desc'

const PRIORITY_ORDER: Record<string, number> = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 }

function naturalKey(key: string): [string, number] {
  const i = key.lastIndexOf('-')
  if (i < 0) return [key, 0]
  const num = parseInt(key.slice(i + 1), 10)
  return [key.slice(0, i), isNaN(num) ? 0 : num]
}

function compare(a: RnIssue, b: RnIssue, key: SortKey, dir: SortDir): number {
  let diff = 0
  if (key === 'key') {
    const [ap, an] = naturalKey(a.key)
    const [bp, bn] = naturalKey(b.key)
    diff = ap < bp ? -1 : ap > bp ? 1 : an - bn
  } else if (key === 'priority') {
    const ao = PRIORITY_ORDER[a.priority ?? ''] ?? 99
    const bo = PRIORITY_ORDER[b.priority ?? ''] ?? 99
    diff = ao - bo
  } else {
    const av = (a[key] ?? '') as string
    const bv = (b[key] ?? '') as string
    diff = av < bv ? -1 : av > bv ? 1 : 0
  }
  return dir === 'asc' ? diff : -diff
}

interface ColDef { key: SortKey; label: string; className?: string }

const COLUMNS: ColDef[] = [
  { key: 'key',      label: 'Key',      className: 'whitespace-nowrap w-px' },
  { key: 'type',     label: 'Type',     className: 'w-px' },
  { key: 'priority', label: 'Priority', className: 'w-px' },
  { key: 'summary',  label: 'Summary',  className: 'w-full' },
  { key: 'status',   label: 'Status',   className: 'whitespace-nowrap w-px' },
]

interface Props {
  issues?: RnIssue[]
  jiraUrl?: string
}

export default function IssueTable({ issues = [], jiraUrl = '' }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('key')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'priority' ? 'asc' : 'asc')
    }
  }

  const sorted = useMemo(
    () => [...issues].sort((a, b) => compare(a, b, sortKey, sortDir)),
    [issues, sortKey, sortDir],
  )

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700">
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
          {!sorted.length ? (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 text-xs">No tickets.</td></tr>
          ) : (
            sorted.map((issue) => (
              <tr key={issue.key} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <td className="px-3 py-2 whitespace-nowrap">
                  {jiraUrl
                    ? <a href={`${jiraUrl}/browse/${issue.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline">{issue.key}</a>
                    : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{issue.key}</span>}
                </td>
                <td className="px-3 py-2"><TagBadge kind="type" value={issue.type} iconOnly /></td>
                <td className="px-3 py-2"><TagBadge kind="priority" value={issue.priority} iconOnly /></td>
                <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{issue.summary}</td>
                <td className="px-3 py-2 whitespace-nowrap"><TagBadge kind="status" value={issue.status} /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
