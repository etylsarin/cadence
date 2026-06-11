import { useEffect, useRef, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import SquadSelector from '@/components/SquadSelector'
import { ALL_SQUADS, storedProject, saveProject } from '@/hooks/useProject'
import { api } from '@/lib/api'
import type { Sprint } from './types'

interface SprintsResponse { items: Sprint[]; hasMore: boolean }

interface Props {
  initialProject?: string | null
  autoSelectIds?: string | null  // comma-separated sprint IDs
  onSelect: (sprints: Array<Sprint & { project: string }>) => void
}

function dateRange(start?: string, end?: string): string {
  if (!start && !end) return ''
  const f = (d?: string) => (d ? d.slice(0, 10) : '?')
  return end ? `${f(start)} – ${f(end)}` : f(start)
}

export default function SprintSidebar({ initialProject = null, autoSelectIds = null, onSelect }: Props) {
  const [project, setProjectState] = useState<string>(initialProject ?? storedProject())
  const [sprints, setSprints]         = useState<Sprint[]>([])
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    const ids = autoSelectIds ? autoSelectIds.split(',').map(Number).filter(Boolean) : []
    return new Set(ids)
  })
  const [squads, setSquads]           = useState<string[]>([])
  const [squadFilter, setSquadFilter] = useState<string | null>(null)

  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect })

  // Emit whenever selectedIds or sprints list changes
  const sprintsRef = useRef(sprints)
  useEffect(() => { sprintsRef.current = sprints }, [sprints])

  function emitSelection(ids: Set<number>, list: Sprint[]) {
    const selected = list.filter((s) => ids.has(s.id)).map((s) => ({ ...s, project }))
    onSelectRef.current(selected)
  }

  function tryAutoSelect(list: Sprint[]): boolean {
    if (!autoSelectIds) return false
    const ids = autoSelectIds.split(',').map(Number).filter(Boolean)
    const matches = list.filter((s) => ids.includes(s.id))
    if (matches.length > 0) {
      const newIds = new Set(matches.map((s) => s.id))
      setSelectedIds(newIds)
      emitSelection(newIds, list)
      return true
    }
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

  async function loadSquads(proj: string) {
    try {
      const data = await api<{ squads: string[] }>(`/sprint-summary/api/squads?project=${proj}`)
      setSquads(data.squads)
    } catch {
      setSquads([])
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
        if (!tryAutoSelect(data.items) && autoSelectIds && data.hasMore) void loadAll(true)
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  useEffect(() => {
    void loadSquads(project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  function onProjectChange(p: string) {
    setProjectState(p)
    saveProject(p)
    setSelectedIds(new Set())
    setSquadFilter(null)
    onSelectRef.current([])
  }

  function toggleSprint(sprint: Sprint) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(sprint.id)) next.delete(sprint.id)
      else next.add(sprint.id)
      emitSelection(next, sprintsRef.current)
      return next
    })
  }

  return (
    <AppSidebar
      title="Sprint Summary"
      icon={BarChart3}
      header={
        <div>
          <SquadSelector value={project} squads={ALL_SQUADS} onChange={onProjectChange} />

          {squads.length > 0 && (
            <div className="mt-3 mb-1">
              <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Squad</div>
              <div className="flex flex-wrap gap-1">
                <button
                  className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition-all ${
                    squadFilter === null
                      ? 'bg-gray-800 dark:bg-slate-500 text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                  onClick={() => setSquadFilter(null)}
                >All</button>
                {squads.map((s) => (
                  <button
                    key={s}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition-all ${
                      squadFilter === s
                        ? 'bg-gray-800 dark:bg-slate-500 text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
                    onClick={() => setSquadFilter(s)}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      }
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
            {(squadFilter ? sprints.filter((s) => s.squads?.includes(squadFilter)) : sprints).map((sprint) => {
              const isSelected = selectedIds.has(sprint.id)
              return (
                <button
                  key={sprint.id}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${isSelected ? 'bg-sidebar-active text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-sidebar-hover'}`}
                  onClick={() => toggleSprint(sprint)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'bg-gray-700 dark:bg-slate-400 border-gray-700 dark:border-slate-400' : 'bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-500'
                    }`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-white dark:text-slate-900" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 border border-gray-900 dark:border-gray-400 ${sprint.state === 'active' ? 'bg-transparent' : 'bg-gray-900 dark:bg-gray-400'}`} />
                    {sprint.name}
                  </div>
                  {(sprint.startDate || sprint.endDate) && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 pl-5">{dateRange(sprint.startDate, sprint.endDate)}</div>
                  )}
                </button>
              )
            })}

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
