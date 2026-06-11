import { useEffect, useState } from 'react'
import { Wand2, Search } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import AppCheckbox from '@/components/AppCheckbox'
import SquadSelector from '@/components/SquadSelector'
import { useProject } from '@/hooks/useProject'
import { api } from '@/lib/api'
import type { TicketStub } from './types'

const PAGE = 30

interface TicketsResponse { items: TicketStub[]; total: number; hasMore: boolean }

interface Props {
  activeKey: string | null
  onSelect: (ticket: TicketStub | null) => void
}

export default function TicketSidebar({ activeKey, onSelect }: Props) {
  const { project, PROJECTS, set: setProject } = useProject()
  const [squads, setSquads]       = useState<string[]>([])
  const [squadFilter, setSquadFilter] = useState<string | null>(null)
  const [showUnfinished, setShowUnfinished] = useState(true)
  const [showFinished, setShowFinished]     = useState(false)
  const [search, setSearch]       = useState('')
  const [needle, setNeedle]       = useState('')
  const [tickets, setTickets]     = useState<TicketStub[]>([])
  const [total, setTotal]         = useState(0)
  const [hasMore, setHasMore]     = useState(false)
  const [loading, setLoading]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]         = useState('')

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setNeedle(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  // Load squads when project changes
  useEffect(() => {
    api<{ squads: string[] }>(`/prompt-builder/api/squads?project=${project}`)
      .then((d) => setSquads(d.squads))
      .catch(() => setSquads([]))
    setSquadFilter(null)
  }, [project])

  // (Re)load tickets whenever project / squad / search / filters change
  useEffect(() => {
    let cancelled = false
    setLoading(true); setTickets([]); setError('')
    const qs = new URLSearchParams({ project, search: needle, limit: String(PAGE), offset: '0', unfinished: String(showUnfinished), finished: String(showFinished) })
    if (squadFilter) qs.set('squad', squadFilter)
    api<TicketsResponse>(`/prompt-builder/api/tickets?${qs}`)
      .then((data) => {
        if (cancelled) return
        setTickets(data.items); setTotal(data.total); setHasMore(data.hasMore)
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project, squadFilter, needle, showUnfinished, showFinished])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const qs = new URLSearchParams({ project, search: needle, limit: String(PAGE), offset: String(tickets.length), unfinished: String(showUnfinished), finished: String(showFinished) })
      if (squadFilter) qs.set('squad', squadFilter)
      const data = await api<TicketsResponse>(`/prompt-builder/api/tickets?${qs}`)
      setTickets((prev) => [...prev, ...data.items])
      setHasMore(data.hasMore)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  function onProjectChange(p: string) {
    setProject(p)
    onSelect(null)
  }

  return (
    <AppSidebar
      title="Prompt Builder"
      icon={Wand2}
      header={
        <div>
          <SquadSelector value={project} squads={PROJECTS} onChange={onProjectChange} />

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
      <div className="flex gap-3 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
        <AppCheckbox checked={showUnfinished} onChange={setShowUnfinished}>Unfinished</AppCheckbox>
        <AppCheckbox checked={showFinished} onChange={setShowFinished}>Finished</AppCheckbox>
      </div>

      <div className="px-4 pb-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search key or summary…"
            className="w-full text-xs rounded border border-gray-200 dark:border-slate-600 pl-7 pr-2.5 py-1.5 text-gray-700 dark:text-gray-100 dark:bg-slate-800 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:border-gray-400"
          />
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-3 text-xs text-gray-400">Loading…</div>
      ) : error ? (
        <div className="px-4 py-3 text-xs text-red-500">{error}</div>
      ) : (
        <div className="px-3 pt-1 pb-1">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5 px-1">
            Tickets {total ? `(${total})` : ''}
          </div>
          <div className="flex flex-col gap-0.5">
            {tickets.map((t) => (
              <button
                key={t.key}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                  t.key === activeKey ? 'bg-sidebar-active text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-sidebar-hover'
                }`}
                onClick={() => onSelect(t)}
              >
                <div className="truncate">
                  <span className="font-medium">{t.key}</span>
                  <span className="ml-1.5">{t.summary}</span>
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500">
                  {[t.type, t.status, t.updated].filter(Boolean).join(' · ')}
                </div>
              </button>
            ))}

            {!tickets.length && <div className="px-1 py-2 text-xs text-gray-400">No tickets found.</div>}

            {hasMore && (
              <button
                className="w-full text-left px-3 py-2 rounded text-xs text-gray-400 hover:text-gray-700 hover:bg-sidebar-hover transition-colors flex items-center gap-1.5"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? <span className="spinner" /> : <span>Show more…</span>}
              </button>
            )}
          </div>
        </div>
      )}
    </AppSidebar>
  )
}
