import { useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import AppCheckbox from '@/components/AppCheckbox'
import SquadSelector from '@/components/SquadSelector'
import { useProject } from '@/hooks/useProject'
import { api } from '@/lib/api'
import type { VersionStub } from './types'

interface VersionsResponse { items: VersionStub[]; total: number; hasMore: boolean }

interface Props {
  autoSelectId?: string | null
  onSelect: (version: VersionStub | null) => void
}

export default function VersionSidebar({ autoSelectId = null, onSelect }: Props) {
  const { project, PROJECTS, set: setProject } = useProject()
  const [unreleased, setUnreleased] = useState(true)
  const [released, setReleased]     = useState(false)
  const [versions, setVersions]     = useState<VersionStub[]>([])
  const [hasMore, setHasMore]       = useState(false)
  const [loading, setLoading]       = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]           = useState('')
  const [activeId, setActiveId]     = useState<string | null>(autoSelectId ? String(autoSelectId) : null)

  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect })

  function tryAutoSelect(list: VersionStub[]): boolean {
    if (!autoSelectId) return false
    const match = list.find((v) => String(v.id) === String(autoSelectId))
    if (match) { onSelectRef.current(match); return true }
    return false
  }

  async function loadAll(silent = false): Promise<void> {
    if (!silent) setLoadingMore(true)
    try {
      const data = await api<VersionsResponse>(
        `/release-notes/api/versions?project=${project}&unreleased=${unreleased}&released=${released}&limit=999&offset=10`,
      )
      setVersions((prev) => {
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

  // (Re)load whenever project / filters change.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setVersions([]); setError('')
    api<VersionsResponse>(
      `/release-notes/api/versions?project=${project}&unreleased=${unreleased}&released=${released}&limit=10&offset=0`,
    )
      .then((data) => {
        if (cancelled) return
        setVersions(data.items)
        setHasMore(data.hasMore)
        if (!tryAutoSelect(data.items) && autoSelectId && data.hasMore) void loadAll(true)
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, unreleased, released])

  function onProjectChange(p: string) {
    setProject(p)
    onSelect(null)
  }

  function selectVersion(v: VersionStub) {
    setActiveId(String(v.id))
    onSelect(v)
  }

  return (
    <AppSidebar
      title="Release Notes"
      icon={FileText}
      header={<SquadSelector value={project} squads={PROJECTS} onChange={onProjectChange} />}
    >
      <div className="flex gap-3 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
        <AppCheckbox checked={unreleased} onChange={setUnreleased}>Unreleased</AppCheckbox>
        <AppCheckbox checked={released} onChange={setReleased}>Released</AppCheckbox>
      </div>

      {loading ? (
        <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
      ) : error ? (
        <div className="px-4 py-3 text-xs text-red-500">{error}</div>
      ) : (
        <div className="px-3 pt-3 pb-1">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5 px-1">Fix Version</div>
          <div className="flex flex-col gap-0.5">
            {versions.map((v) => (
              <button
                key={v.id}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                  String(v.id) === activeId ? 'bg-sidebar-active text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-sidebar-hover'
                }`}
                onClick={() => selectVersion(v)}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 border border-gray-900 dark:border-gray-400 ${v.released ? 'bg-gray-900 dark:bg-gray-400' : 'bg-transparent'}`} />
                  <span>{v.name}</span>
                </div>
                {v.releaseDate && <div className="text-[10px] text-gray-400 dark:text-gray-500 pl-3.5">{v.releaseDate}</div>}
              </button>
            ))}

            {!versions.length && <div className="px-1 py-2 text-xs text-gray-400">No versions found.</div>}

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
