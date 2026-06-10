import { useEffect, useRef, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import SquadSelector from '@/components/SquadSelector'
import { PROJECTS, storedProject, saveProject } from '@/hooks/useProject'
import { api } from '@/lib/api'
import type { Sprint } from './types'

interface SprintsResponse { items: Sprint[]; hasMore: boolean }

interface Props {
  initialProject?: string | null
  autoSelectId?: string | number | null
  onSelect: (sprint: (Sprint & { project: string }) | null) => void
}

function dateRange(start?: string, end?: string): string {
  if (!start && !end) return ''
  const f = (d?: string) => (d ? d.slice(0, 10) : '?')
  return end ? `${f(start)} – ${f(end)}` : f(start)
}

export default function SprintSidebar({ initialProject = null, autoSelectId = null, onSelect }: Props) {
  const [project, setProjectState] = useState<string>(initialProject ?? storedProject())
  const [sprints, setSprints]       = useState<Sprint[]>([])
  const [hasMore, setHasMore]       = useState(false)
  const [loading, setLoading]       = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]           = useState('')
  const [activeId, setActiveId]     = useState<number | null>(autoSelectId ? Number(autoSelectId) : null)

  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect })

  function tryAutoSelect(list: Sprint[]): boolean {
    if (!autoSelectId) return false
    const match = list.find((s) => s.id === Number(autoSelectId))
    if (match) { onSelectRef.current({ ...match, project }); return true }
    return false
  }

  async function loadAll(silent = false): Promise<void> {
    if (!silent) setLoadingMore(true)
    try {
      const data = await api<SprintsResponse>(`/sprint-summary/api/sprints?project=${project}&limit=999&offset=10`)
      setSprints((prev) => {
        const merged = [...prev, ...data.items]
        if (silent) tryAutoSelect(merged)
        return merged
      })
      setHasMore(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setSprints([]); setError('')
    api<SprintsResponse>(`/sprint-summary/api/sprints?project=${project}&limit=10&offset=0`)
      .then((data) => {
        if (cancelled) return
        setSprints(data.items)
        setHasMore(data.hasMore)
        if (!tryAutoSelect(data.items) && autoSelectId && data.hasMore) void loadAll(true)
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  function onProjectChange(p: string) {
    setProjectState(p)
    saveProject(p)
    onSelect(null)
  }

  function selectSprint(sprint: Sprint) {
    setActiveId(sprint.id)
    onSelect({ ...sprint, project })
  }

  return (
    <AppSidebar
      title="Sprint Summary"
      icon={BarChart3}
      header={<SquadSelector value={project} squads={PROJECTS} onChange={onProjectChange} />}
    >
      {loading ? (
        <div className="px-4 py-3 text-xs text-gray-400">Loading sprints…</div>
      ) : error ? (
        <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
          {error.includes('No Scrum board') ? "This squad doesn't use sprints — no board found." : error}
        </div>
      ) : (
        <div className="px-3 pt-3 pb-1">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5 px-1">Sprint</div>
          <div className="flex flex-col gap-0.5">
            {sprints.map((sprint) => (
              <button
                key={sprint.id}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${sprint.id === activeId ? 'bg-sidebar-active text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-sidebar-hover'}`}
                onClick={() => selectSprint(sprint)}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 border border-gray-900 dark:border-gray-400 ${sprint.state === 'active' ? 'bg-transparent' : 'bg-gray-900 dark:bg-gray-400'}`} />
                  {sprint.name}
                </div>
                {(sprint.startDate || sprint.endDate) && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 pl-3.5">{dateRange(sprint.startDate, sprint.endDate)}</div>
                )}
              </button>
            ))}

            {!sprints.length && <div className="px-1 py-2 text-xs text-gray-400">No sprints found.</div>}

            {hasMore && (
              <button
                className="w-full text-left px-3 py-2 rounded text-xs text-gray-400 hover:text-gray-700 hover:bg-sidebar-hover transition-colors flex items-center gap-1.5"
                disabled={loadingMore}
                onClick={() => loadAll()}
              >
                {loadingMore ? <span className="spinner" /> : <span>Show all…</span>}
              </button>
            )}
          </div>
        </div>
      )}
    </AppSidebar>
  )
}
