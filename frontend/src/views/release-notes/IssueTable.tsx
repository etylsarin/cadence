import { useState } from 'react'
import TagBadge from '@/components/TagBadge'
import AppCheckbox from '@/components/AppCheckbox'
import type { RnIssue } from './types'

/** Column-toggle state persisted to localStorage (cadence:rn:col:*). */
function useColPref(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const lsKey = `cadence:rn:col:${key}`
  const [val, setVal] = useState<boolean>(() => {
    const v = localStorage.getItem(lsKey)
    return v === null ? def : v === 'true'
  })
  const set = (v: boolean) => { setVal(v); localStorage.setItem(lsKey, String(v)) }
  return [val, set]
}

interface Props {
  issues?: RnIssue[]
  jiraUrl?: string
}

export default function IssueTable({ issues = [], jiraUrl = '' }: Props) {
  const [showKey, setShowKey]           = useColPref('key', true)
  const [showType, setShowType]         = useColPref('type', true)
  const [showPriority, setShowPriority] = useColPref('priority', true)
  const [showSummary, setShowSummary]   = useColPref('summary', true)
  const [showStatus, setShowStatus]     = useColPref('status', true)
  const [showLinks, setShowLinks]       = useColPref('links', true)
  const [copyLabel, setCopyLabel]       = useState('Copy')

  async function copyIssues() {
    if (!issues.length) return
    const header: string[] = []
    if (showKey)      header.push('Key')
    if (showType)     header.push('Type')
    if (showPriority) header.push('Priority')
    if (showSummary)  header.push('Summary')
    if (showStatus)   header.push('Status')

    const rows = issues.map((i) => {
      const cols: (string | undefined)[] = []
      if (showKey)      cols.push(showLinks && jiraUrl ? `${jiraUrl}/browse/${i.key}` : i.key)
      if (showType)     cols.push(i.type)
      if (showPriority) cols.push(i.priority)
      if (showSummary)  cols.push(i.summary)
      if (showStatus)   cols.push(i.status)
      return cols.join('\t')
    })

    await navigator.clipboard.writeText([header.join('\t'), ...rows].join('\n'))
    setCopyLabel('Copied!')
    setTimeout(() => setCopyLabel('Copy'), 2000)
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-medium text-gray-400 dark:text-gray-500">Columns</span>
        <AppCheckbox checked={showKey} onChange={setShowKey}>Key</AppCheckbox>
        <AppCheckbox checked={showType} onChange={setShowType}>Type</AppCheckbox>
        <AppCheckbox checked={showPriority} onChange={setShowPriority}>Priority</AppCheckbox>
        <AppCheckbox checked={showSummary} onChange={setShowSummary}>Summary</AppCheckbox>
        <AppCheckbox checked={showStatus} onChange={setShowStatus}>Status</AppCheckbox>
        <AppCheckbox checked={showLinks} onChange={setShowLinks}>Links</AppCheckbox>
        <div className="ml-auto">
          <button
            className="px-3 py-1 rounded border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-gray-900 dark:hover:border-slate-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            onClick={copyIssues}
          >{copyLabel}</button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
              {showKey      && <th className="px-3 py-2 font-medium whitespace-nowrap w-px">Key</th>}
              {showType     && <th className="px-3 py-2 font-medium w-px">Type</th>}
              {showPriority && <th className="px-3 py-2 font-medium w-px">Priority</th>}
              {showSummary  && <th className="px-3 py-2 font-medium">Summary</th>}
              {showStatus   && <th className="px-3 py-2 font-medium w-px whitespace-nowrap">Status</th>}
              <th className="w-full" />
            </tr>
          </thead>
          <tbody>
            {!issues.length ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 text-xs">No tickets.</td></tr>
            ) : (
              issues.map((issue) => (
                <tr key={issue.key} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  {showKey && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      {showLinks && jiraUrl
                        ? <a href={`${jiraUrl}/browse/${issue.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline">{issue.key}</a>
                        : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{issue.key}</span>}
                    </td>
                  )}
                  {showType     && <td className="px-3 py-2"><TagBadge kind="type" value={issue.type} iconOnly /></td>}
                  {showPriority && <td className="px-3 py-2"><TagBadge kind="priority" value={issue.priority} iconOnly /></td>}
                  {showSummary  && <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{issue.summary}</td>}
                  {showStatus   && <td className="px-3 py-2 whitespace-nowrap"><TagBadge kind="status" value={issue.status} /></td>}
                  <td />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
