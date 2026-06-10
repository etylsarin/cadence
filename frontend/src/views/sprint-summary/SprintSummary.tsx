import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SprintSidebar from './SprintSidebar'
import MetricsTable from './MetricsTable'
import TicketsTable from './TicketsTable'
import EmptyState from '@/components/EmptyState'
import { api } from '@/lib/api'
import type { Sprint, SprintSummaryData } from './types'

export default function SprintSummary() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sprint, setSprint]   = useState<(Sprint & { project: string }) | null>(null)
  const [data, setData]       = useState<SprintSummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const initialProject = searchParams.get('project')
  const autoSelectId   = searchParams.get('sprint')

  async function onSelect(selected: (Sprint & { project: string }) | null) {
    if (!selected) { setSprint(null); setData(null); return }
    setSprint(selected); setData(null); setLoading(true); setError('')
    setSearchParams({ project: selected.project ?? '', sprint: String(selected.id) }, { replace: true })
    try {
      const d = await api<SprintSummaryData>(`/sprint-summary/api/sprint-summary?project=${selected.project ?? ''}&sprint_id=${selected.id}`)
      setData(d)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <SprintSidebar initialProject={initialProject} autoSelectId={autoSelectId} onSelect={onSelect} />

      <div className="flex-1 overflow-y-auto">
        {!sprint ? (
          <EmptyState message="Select a sprint to view its summary" />
        ) : (
          <div className="px-8 py-7 max-w-5xl">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 border border-gray-900 ${sprint.state === 'active' ? 'bg-white dark:bg-slate-900' : 'bg-gray-900'}`}
                  title={sprint.state === 'active' ? 'Active' : 'Closed'}
                />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{sprint.name}</h2>
                {data?.jiraUrl && (
                  <a
                    href={`${data.jiraUrl}/jira/software/c/projects/${sprint.project}/boards/${data.boardId}/reports/sprint-retrospective?sprint=${sprint.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >Jira ↗</a>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pl-5 text-xs">
                <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Status</span><span className="text-gray-700 dark:text-gray-300">{sprint.state === 'active' ? 'Active' : 'Closed'}</span></span>
                {sprint.startDate && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Start</span><span className="text-gray-700 dark:text-gray-300">{sprint.startDate.slice(0, 10)}</span></span>}
                {sprint.endDate && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">End</span><span className="text-gray-700 dark:text-gray-300">{sprint.endDate.slice(0, 10)}</span></span>}
                <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Id</span><span className="text-gray-700 dark:text-gray-300">{sprint.id}</span></span>
              </div>
              <div className="mt-2 pl-5 text-xs">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Goal</span>
                <span className="text-gray-700 dark:text-gray-300">{data?.sprint?.goal || '—'}</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500 mb-6"><span className="spinner" /> Loading metrics…</div>
            ) : error ? (
              <div className="text-sm text-red-500 mb-6">{error}</div>
            ) : null}

            {data && (
              <>
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Metrics</h3>
                  <MetricsTable rows={data.rows} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Tickets</h3>
                  <TicketsTable issues={data.issues} jiraUrl={data.jiraUrl} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
