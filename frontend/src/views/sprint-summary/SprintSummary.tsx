import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SprintSidebar from './SprintSidebar'
import MetricsTable from './MetricsTable'
import TicketsTable from './TicketsTable'
import EmptyState from '@/components/EmptyState'
import { api } from '@/lib/api'
import type { Sprint, SprintSummaryData, SsIssue, SummaryRows, MetricRow } from './types'

type SprintWithProject = Sprint & { project: string }

function mergeIssues(dataMap: Map<number, SprintSummaryData>, sprintIds: number[]): SsIssue[] {
  const seen = new Map<string, SsIssue>()
  for (const id of sprintIds) {
    const d = dataMap.get(id)
    if (!d) continue
    for (const issue of d.issues) seen.set(issue.key, issue)
  }
  return Array.from(seen.values())
}

function computeRows(issues: SsIssue[]): SummaryRows {
  const pts = (i: SsIssue) => i.points || 0

  function cell(subset: SsIssue[]): { count: number; points: number } {
    const p = subset.reduce((s, i) => s + pts(i), 0)
    return { count: subset.length, points: Number.isInteger(p) ? p : parseFloat(p.toFixed(1)) }
  }

  function row(subset: SsIssue[]): MetricRow {
    const d = subset.filter((i) => i.delivered)
    const a = subset.filter((i) => i.approved)
    const c = subset.filter((i) => i.delivered || i.approved)
    return { available: true, ...cell(subset), delivered: cell(d), approved: cell(a), completed: cell(c) }
  }

  return {
    planned:  row(issues.filter((i) => !i.injected)),
    injected: row(issues.filter((i) => i.injected)),
    total:    row(issues),
  }
}

export default function SprintSummary() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedSprints, setSelectedSprints] = useState<SprintWithProject[]>([])
  const [dataMap, setDataMap]   = useState<Map<number, SprintSummaryData>>(new Map())
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const initialProject = searchParams.get('project')
  const autoSelectIds  = searchParams.get('sprints')

  const pendingRef = useRef<Set<number>>(new Set())

  async function onSelect(sprints: SprintWithProject[]) {
    setSelectedSprints(sprints)
    if (!sprints.length) return

    setSearchParams(
      { project: sprints[0].project, sprints: sprints.map((s) => s.id).join(',') },
      { replace: true },
    )

    // Fetch data for any newly selected sprint not yet in dataMap
    const toFetch = sprints.filter((s) => !dataMap.has(s.id) && !pendingRef.current.has(s.id))
    if (!toFetch.length) return

    for (const s of toFetch) pendingRef.current.add(s.id)
    setLoading(true); setError('')
    try {
      const results = await Promise.all(
        toFetch.map((s) =>
          api<SprintSummaryData>(`/sprint-summary/api/sprint-summary?project=${s.project}&sprint_id=${s.id}`)
            .then((d) => ({ id: s.id, data: d }))
        )
      )
      setDataMap((prev) => {
        const next = new Map(prev)
        for (const { id, data } of results) next.set(id, data)
        return next
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      for (const s of toFetch) pendingRef.current.delete(s.id)
      setLoading(false)
    }
  }

  const loadedIds = selectedSprints.map((s) => s.id).filter((id) => dataMap.has(id))
  const mergedIssues = useMemo(() => mergeIssues(dataMap, loadedIds), [dataMap, loadedIds])
  const mergedRows   = useMemo(() => computeRows(mergedIssues), [mergedIssues])

  const firstData = loadedIds.length ? dataMap.get(loadedIds[0]) : undefined

  // Date range across all selected sprints
  const startDates = selectedSprints.map((s) => s.startDate).filter(Boolean) as string[]
  const endDates   = selectedSprints.map((s) => s.endDate).filter(Boolean) as string[]
  const rangeStart = startDates.length ? startDates.reduce((a, b) => (a < b ? a : b)) : ''
  const rangeEnd   = endDates.length   ? endDates.reduce((a, b) => (a > b ? a : b))   : ''

  const isMulti = selectedSprints.length > 1

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <SprintSidebar
        initialProject={initialProject}
        autoSelectIds={autoSelectIds}
        onSelect={onSelect}
      />

      <div className="flex-1 overflow-y-auto">
        {!selectedSprints.length ? (
          <EmptyState message="Select a sprint to view its summary" />
        ) : (
          <div className="px-8 py-7 max-w-5xl">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                {!isMulti && (
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 border border-gray-900 ${selectedSprints[0].state === 'active' ? 'bg-white dark:bg-slate-900' : 'bg-gray-900'}`}
                    title={selectedSprints[0].state === 'active' ? 'Active' : 'Closed'}
                  />
                )}
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {isMulti
                    ? selectedSprints.map((s) => s.name).join(' · ')
                    : selectedSprints[0].name}
                </h2>
                {!isMulti && firstData?.jiraUrl && (
                  <a
                    href={`${firstData.jiraUrl}/jira/software/c/projects/${selectedSprints[0].project}/boards/${firstData.boardId}/reports/sprint-retrospective?sprint=${selectedSprints[0].id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >Jira ↗</a>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pl-5 text-xs">
                {isMulti ? (
                  <>
                    <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Sprints</span><span className="text-gray-700 dark:text-gray-300">{selectedSprints.length}</span></span>
                    {rangeStart && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Start</span><span className="text-gray-700 dark:text-gray-300">{rangeStart.slice(0, 10)}</span></span>}
                    {rangeEnd   && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">End</span><span className="text-gray-700 dark:text-gray-300">{rangeEnd.slice(0, 10)}</span></span>}
                  </>
                ) : (
                  <>
                    <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Status</span><span className="text-gray-700 dark:text-gray-300">{selectedSprints[0].state === 'active' ? 'Active' : 'Closed'}</span></span>
                    {selectedSprints[0].startDate && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Start</span><span className="text-gray-700 dark:text-gray-300">{selectedSprints[0].startDate.slice(0, 10)}</span></span>}
                    {selectedSprints[0].endDate   && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">End</span><span className="text-gray-700 dark:text-gray-300">{selectedSprints[0].endDate.slice(0, 10)}</span></span>}
                    <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Id</span><span className="text-gray-700 dark:text-gray-300">{selectedSprints[0].id}</span></span>
                  </>
                )}
              </div>

              {!isMulti && (
                <div className="mt-2 pl-5 text-xs">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Goal</span>
                  <span className="text-gray-700 dark:text-gray-300">{firstData?.sprint?.goal || '—'}</span>
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500 mb-6"><span className="spinner" /> Loading metrics…</div>
            ) : error ? (
              <div className="text-sm text-red-500 mb-6">{error}</div>
            ) : null}

            {loadedIds.length > 0 && (
              <>
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Metrics</h3>
                  <MetricsTable rows={mergedRows} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Tickets</h3>
                  <TicketsTable issues={mergedIssues} jiraUrl={firstData?.jiraUrl} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
