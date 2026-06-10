import { useEffect, useMemo, useRef, useState } from 'react'
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

async function fetchPngDataUri(path: string): Promise<string> {
  const buf = await fetch(path).then((r) => r.arrayBuffer())
  const bytes = new Uint8Array(buf)
  let b64 = ''
  for (const b of bytes) b64 += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(b64)}`
}

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

  const [copyLabel, setCopyLabel]         = useState('Copy for PPT')
  const [copyJsonLabel, setCopyJsonLabel] = useState('Copy JSON')

  const visible = useMemo(() => issues.filter((i) => {
    const scope   = i.injected ? fInjected : fPlanned
    const outcome = i.approved ? fApproved : i.delivered ? fDelivered : fOther
    return scope && outcome
  }), [issues, fPlanned, fInjected, fDelivered, fApproved, fOther])

  const spTotal = useMemo(() => visible.reduce((s, i) => s + (i.points || 0), 0), [visible])

  // Pre-load PPT icons so the copy handler runs synchronously within the click gesture.
  const pngs = useRef({ spike: '', releaseTag: '', demo: '' })
  useEffect(() => {
    Promise.all([
      fetchPngDataUri('/assets/pptx_spike.png'),
      fetchPngDataUri('/assets/pptx_releasetag.png'),
      fetchPngDataUri('/assets/pptx_demo.png'),
    ]).then(([spike, releaseTag, demo]) => { pngs.current = { spike, releaseTag, demo } })
      .catch(() => { /* non-critical */ })
  }, [])

  function groupByEpic() {
    const epicOrder: string[] = []
    const byEpic: Record<string, { epicKey: string | null; epicName: string; issues: SsIssue[] }> = {}
    for (const i of visible) {
      const key  = i.epicKey || '__none__'
      const name = i.epicName || (i.epicKey ? i.epicKey : 'No Epic')
      if (!byEpic[key]) { byEpic[key] = { epicKey: key === '__none__' ? null : key, epicName: name, issues: [] }; epicOrder.push(key) }
      byEpic[key].issues.push(i)
    }
    return { epicOrder, byEpic }
  }

  function copyJson() {
    if (!visible.length) return
    const { epicOrder, byEpic } = groupByEpic()
    navigator.clipboard.writeText(JSON.stringify(epicOrder.map((k) => byEpic[k]), null, 2))
    setCopyJsonLabel('Copied!')
    setTimeout(() => setCopyJsonLabel('Copy JSON'), 2000)
  }

  function copyTicketTable() {
    if (!visible.length) return
    const { spike, releaseTag, demo } = pngs.current
    const imgTag = (png: string, display: number) => (png ? `<img src="${png}" width="${display}" height="${display}">` : '')
    const { epicOrder, byEpic } = groupByEpic()

    const rows: string[] = []
    let firstIssueRow = true
    for (const epicKey of epicOrder) {
      const { epicName, issues: epicIssues } = byEpic[epicKey]
      rows.push(`<tr><td colspan="6" style="font-weight:bold;background:#f0f0f0">${epicName}</td></tr>`)
      for (const i of epicIssues) {
        const keyCell     = jiraUrl ? `<a href="${jiraUrl}/browse/${i.key}">${i.key}</a>` : i.key
        const tl          = (i.type || '').toLowerCase()
        const typeCell    = (firstIssueRow || tl.includes('spike')) ? imgTag(spike, 32) : ''
        const releaseIcon = (firstIssueRow || i.fixVersion) ? imgTag(releaseTag, 24) : ''
        const releaseDate = i.fixVersion || ''
        const demoCell    = firstIssueRow ? imgTag(demo, 32) : ''
        firstIssueRow     = false
        rows.push(`<tr><td>${keyCell}</td><td>${releaseIcon}</td><td>${releaseDate}</td><td>${typeCell}</td><td>${demoCell}</td><td>${i.summary}</td></tr>`)
      }
    }

    const html = `<table border="1" cellspacing="0" cellpadding="4">${rows.join('')}</table>`
    const blob = new Blob([html], { type: 'text/html' })
    navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
    setCopyLabel('Copied!')
    setTimeout(() => setCopyLabel('Copy for PPT'), 2000)
  }

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

        <div className="ml-auto flex gap-2">
          <button className="px-3 py-1 rounded border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-gray-900 dark:hover:border-slate-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors" onClick={copyJson}>{copyJsonLabel}</button>
          <button className="px-3 py-1 rounded border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-gray-900 dark:hover:border-slate-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors" onClick={copyTicketTable}>{copyLabel}</button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Key</th>
              <th className="px-3 py-2 font-medium text-right">SP</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium w-full">Summary</th>
              <th className="px-3 py-2 font-medium">Status</th>
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
