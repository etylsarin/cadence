import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import TagBadge from '@/components/TagBadge'
import AppCheckbox from '@/components/AppCheckbox'
import type { SsIssue } from './types'

function useFilterPref(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const lsKey = `cadence:ss:filter:${key}`
  const [val, setVal] = useState<boolean>(() => {
    const v = localStorage.getItem(lsKey)
    return v === null ? def : v === 'true'
  })
  return [val, (v: boolean) => { setVal(v); localStorage.setItem(lsKey, String(v)) }]
}

function fmt(n: number | null | undefined): string {
  if (n == null) return ''
  return Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(1)
}

type SortKey = 'scope' | 'key' | 'points' | 'type' | 'summary' | 'status'
type SortDir = 'asc' | 'desc'

function naturalKey(key: string): [string, number] {
  const i = key.lastIndexOf('-')
  if (i < 0) return [key, 0]
  const num = parseInt(key.slice(i + 1), 10)
  return [key.slice(0, i), isNaN(num) ? 0 : num]
}

function compare(a: SsIssue, b: SsIssue, key: SortKey, dir: SortDir): number {
  let diff = 0
  if (key === 'key') {
    const [ap, an] = naturalKey(a.key)
    const [bp, bn] = naturalKey(b.key)
    diff = ap < bp ? -1 : ap > bp ? 1 : an - bn
  } else if (key === 'points') {
    diff = (a.points ?? -1) - (b.points ?? -1)
  } else if (key === 'scope') {
    const av = a.injected ? 'injected' : 'planned'
    const bv = b.injected ? 'injected' : 'planned'
    diff = av < bv ? -1 : av > bv ? 1 : 0
  } else {
    const av = (a[key] ?? '') as string
    const bv = (b[key] ?? '') as string
    diff = av < bv ? -1 : av > bv ? 1 : 0
  }
  return dir === 'asc' ? diff : -diff
}

interface ColDef { key: SortKey; label: string; className?: string }

const COLUMNS: ColDef[] = [
  { key: 'scope',   label: 'Scope',   className: 'w-px' },
  { key: 'key',     label: 'Key',     className: 'whitespace-nowrap w-px' },
  { key: 'points',  label: 'SP',      className: 'text-right w-px' },
  { key: 'type',    label: 'Type',    className: 'w-px' },
  { key: 'summary', label: 'Summary', className: 'w-full' },
  { key: 'status',  label: 'Status',  className: 'whitespace-nowrap w-px' },
]

interface Props {
  issues?: SsIssue[]
  jiraUrl?: string
}

export default function TicketsTable({ issues = [], jiraUrl = '' }: Props) {
  const [fPlanned, setFPlanned]     = useFilterPref('planned', true)
  const [fInjected, setFInjected]   = useFilterPref('injected', true)
  const [fDelivered, setFDelivered] = useFilterPref('delivered', true)
  const [fApproved, setFApproved]   = useFilterPref('approved', true)
  const [fOther, setFOther]         = useFilterPref('other', true)

  const [sortKey, setSortKey] = useState<SortKey>('key')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'points' ? 'desc' : 'asc')
    }
  }

  const visible = useMemo(() => {
    const filtered = issues.filter((i) => {
      const scope   = i.injected ? fInjected : fPlanned
      const outcome = i.approved ? fApproved : i.delivered ? fDelivered : fOther
      return scope && outcome
    })
    return [...filtered].sort((a, b) => compare(a, b, sortKey, sortDir))
  }, [issues, fPlanned, fInjected, fDelivered, fApproved, fOther, sortKey, sortDir])

  const spTotal = useMemo(() => visible.reduce((s, i) => s + (i.points || 0), 0), [visible])

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-medium text-gray-400 dark:text-gray-500">Scope</span>
        <AppCheckbox checked={fPlanned} onChange={setFPlanned}>Planned</AppCheckbox>
        <AppCheckbox checked={fInjected} onChange={setFInjected}>Injected</AppCheckbox>

        <span className="border-l border-gray-200 dark:border-slate-700 h-4 mx-1" />

        <span className="font-medium text-gray-400 dark:text-gray-500">Outcome</span>
        <AppCheckbox checked={fDelivered} onChange={setFDelivered}>Delivered</AppCheckbox>
        <AppCheckbox checked={fApproved} onChange={setFApproved}>Approved for PROD</AppCheckbox>
        <AppCheckbox checked={fOther} onChange={setFOther}>Not Done</AppCheckbox>

        <span className="border-l border-gray-200 dark:border-slate-700 h-4 mx-1" />

        <span className="text-gray-900 dark:text-gray-100 font-semibold">
          {visible.length} issues
          {spTotal ? <span> · {fmt(spTotal)} SP</span> : null}
        </span>
      </div>

      {/* Table */}
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
            {!visible.length ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 text-xs">No tickets match the current filters.</td></tr>
            ) : (
              visible.map((issue) => (
                <tr key={issue.key} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <td className="px-3 py-2"><TagBadge kind="scope" value={issue.injected ? 'injected' : 'planned'} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {jiraUrl
                      ? <a href={`${jiraUrl}/browse/${issue.key}`} target="_blank" rel="noreferrer" className={`text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline ${issue.removed ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}>{issue.key}</a>
                      : <span className={`text-xs font-mono text-gray-500 dark:text-gray-400 ${issue.removed ? 'line-through' : ''}`}>{issue.key}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmt(issue.points) || ''}</td>
                  <td className="px-3 py-2"><TagBadge kind="type" value={issue.type} iconOnly /></td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{issue.summary}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><TagBadge kind="status" value={issue.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
