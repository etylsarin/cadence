import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type KeyboardEvent,
} from 'react'
import { ExternalLink, Search, ChevronDown, ChevronRight, ChevronUp, Loader2, X } from 'lucide-react'
import AppInfoPanel from '@/components/AppInfoPanel'
import { getTagProps } from '@/lib/tags'
import { PRIORITY_LEVELS, normalizePriority } from './simulate'
import type { RecentEpic, SelectedEpic, EpicOverride, EpicEditPayload } from './types'

type SortKey = 'selected' | 'priority' | 'key' | 'title' | 'todo' | 'status' | 'created' | 'updated'

export interface PlannerScopeHandle {
  /** Re-sort by Key desc so a freshly-added custom row (CUST-N) lands on top. */
  resetSortForNew: () => void
}

interface Props {
  squad: string
  recentEpicsByProject: Record<string, RecentEpic[]>
  customEpics?: RecentEpic[]
  nextCustomKey?: string
  loadingEpicsFor?: string | null
  selectedEpics: SelectedEpic[]
  epicOverrides?: Record<string, EpicOverride>
  statusInScope: Record<string, boolean>
  loadingChildren?: boolean
  jiraUrl?: string
  onToggleEpic: (project: string, epic: RecentEpic) => void
  onToggleStatus: (name: string) => void
  onAddCustomEpic: (payload: { name: string; items: number; priority: string }) => void
  onRemoveCustomEpic: (key: string) => void
  onUpdateEpic: (payload: EpicEditPayload) => void
}

const OVR_BG = 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-900 dark:text-yellow-200'
const OVR_TITLE = 'Not synced to Jira'

function priorityCls(level: string): string {
  return level === 'Critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
    : level === 'High' ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
      : level === 'Low' ? 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-300'
        : 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'   // Medium
}

const PlannerScope = forwardRef<PlannerScopeHandle, Props>(function PlannerScope(
  {
    squad, recentEpicsByProject, customEpics = [], nextCustomKey = '', loadingEpicsFor = null,
    selectedEpics, epicOverrides = {}, statusInScope, jiraUrl = '',
    onToggleEpic, onToggleStatus, onAddCustomEpic, onRemoveCustomEpic, onUpdateEpic,
  },
  ref,
) {
  const [search, setSearch] = useState('')
  const [statusOpen, setStatusOpen] = useState(false)

  // Persistent "add custom epic" sub-header row state.
  const [customName, setCustomName] = useState('')
  const [customItems, setCustomItems] = useState(10)
  const [customPriority, setCustomPriority] = useState('Medium')

  function submitCustom() {
    const items = Math.max(0, Math.round(Number(customItems || 0)))
    if (!customName.trim() || items <= 0) return
    onAddCustomEpic({ name: customName.trim(), items, priority: customPriority })
    setCustomName(''); setCustomItems(10); setCustomPriority('Medium')
  }

  // Client-side column sorting (default: most-recently-updated first).
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function setSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      const ascByDefault = key === 'key' || key === 'title' || key === 'status' || key === 'selected' || key === 'priority'
      setSortDir(ascByDefault ? 'asc' : 'desc')
    }
  }

  useImperativeHandle(ref, () => ({
    resetSortForNew: () => { setSortKey('key'); setSortDir('desc') },
  }), [])

  // ── Selection helpers ───────────────────────────────────────────────────────
  const isSelected = useCallback((key: string) => selectedEpics.some((e) => e.key === key), [selectedEpics])
  const selectedColor = useCallback((key: string) => selectedEpics.find((e) => e.key === key)?.color || null, [selectedEpics])
  const selectedPriority = useCallback((key: string) => {
    const e = selectedEpics.find((x) => x.key === key)
    return e ? e.priorityLevel || 'Medium' : null
  }, [selectedEpics])

  const selectedForSquad = useMemo(() => selectedEpics.filter((e) => e.project === squad), [selectedEpics, squad])

  function countInScope(epic: SelectedEpic): number {
    if (epic.custom) return Math.max(0, Number(epic.customItems || 0))
    if (!epic.children) return 0
    return epic.children.filter((c) => statusInScope[c.status]).length
  }

  const summary = useMemo(() => ({
    epics: selectedForSquad.length,
    items: selectedForSquad.reduce((s, e) => s + countInScope(e), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selectedForSquad, statusInScope])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of selectedForSquad) for (const c of e.children || []) counts[c.status] = (counts[c.status] || 0) + 1
    return counts
  }, [selectedForSquad])

  const includedItems = summary.items

  /** Items "in scope" for one epic in the table (override map wins, then custom,
   *  then the filter-derived count from child_status_counts). */
  const inScopeForEpic = useCallback((ep: RecentEpic): number => {
    const ovr = epicOverrides[ep.key]
    if (ovr?.overrideItems != null) return Math.max(0, Number(ovr.overrideItems))
    if (ep.custom) return Math.max(0, Number(ep.customItems || 0))
    const breakdown = ep.child_status_counts
    if (!breakdown) return ep.child_count || 0
    let n = 0
    for (const [status, count] of Object.entries(breakdown)) if (statusInScope[status]) n += count
    return n
  }, [epicOverrides, statusInScope])

  /** Jira-derived count, ignoring the override map (for honest yellow chips). */
  const baselineItems = useCallback((ep: RecentEpic): number => {
    if (ep.custom) return Math.max(0, Number(ep.customItems || 0))
    const breakdown = ep.child_status_counts
    if (!breakdown) return ep.child_count || 0
    let n = 0
    for (const [status, count] of Object.entries(breakdown)) if (statusInScope[status]) n += count
    return n
  }, [statusInScope])

  const effectivePriority = useCallback((ep: RecentEpic): string => {
    const ovr = epicOverrides[ep.key]
    return ovr?.priorityLevel || selectedPriority(ep.key) || ep.priorityLevel || (ep.priority ? normalizePriority(ep.priority) : '') || 'Medium'
  }, [epicOverrides, selectedPriority])

  const effectiveTitle = useCallback((ep: RecentEpic): string => {
    const ovr = epicOverrides[ep.key]
    return ovr?.overrideTitle || ep.summary || ''
  }, [epicOverrides])

  // "Not synced to Jira" highlighters.
  const titleOverridden = (ep: RecentEpic) => ep.custom || (!!epicOverrides[ep.key]?.overrideTitle && epicOverrides[ep.key]!.overrideTitle !== (ep.summary || ''))
  const itemsOverridden = (ep: RecentEpic) => ep.custom || epicOverrides[ep.key]?.overrideItems != null
  const priorityOverridden = (ep: RecentEpic) => {
    if (ep.custom) return true
    const ovr = epicOverrides[ep.key]
    if (!ovr?.priorityLevel) return false
    return ovr.priorityLevel !== (ep.priority ? normalizePriority(ep.priority) : null)
  }

  // ── Sorting ─────────────────────────────────────────────────────────────────
  const sortValue = useCallback((ep: RecentEpic): string | number => {
    switch (sortKey) {
      case 'selected': return isSelected(ep.key) ? 0 : 1
      case 'priority': {
        const level = selectedPriority(ep.key) || normalizePriority(ep.priority)
        const idx = PRIORITY_LEVELS.indexOf(level)
        return idx < 0 ? PRIORITY_LEVELS.length : idx
      }
      case 'key': return ep.key || ''
      case 'title': return (ep.summary || '').toLowerCase()
      case 'todo': return inScopeForEpic(ep)
      case 'status': return (ep.status || '').toLowerCase()
      case 'created': return ep.created || ''
      case 'updated': return ep.updated || ''
      default: return ''
    }
  }, [sortKey, isSelected, selectedPriority, inScopeForEpic])

  const matchesSearch = useCallback((ep: RecentEpic) =>
    !search || `${ep.key} ${ep.summary}`.toLowerCase().includes(search.toLowerCase()), [search])

  const epicList = useMemo(() => {
    const out: RecentEpic[] = []
    for (const ep of recentEpicsByProject[squad] || []) {
      if ((ep.child_count || 0) === 0) continue   // always hide empty epics
      if (!matchesSearch(ep)) continue
      out.push(ep)
    }
    for (const ep of customEpics) if (matchesSearch(ep)) out.push(ep)
    const dir = sortDir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      // Key sort: pin customs to the "high" end (locale-proof; see Vue original).
      if (sortKey === 'key' && !!a.custom !== !!b.custom) return (a.custom ? 1 : -1) * dir
      const va = sortValue(a), vb = sortValue(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
      return cmp * dir
    })
    return out
  }, [recentEpicsByProject, squad, customEpics, matchesSearch, sortKey, sortDir, sortValue])

  // ── Scroll-bottom hint for the epic list ───────────────────────────────────
  const epicListRef = useRef<HTMLDivElement>(null)
  const [showMoreHint, setShowMoreHint] = useState(false)
  const refreshHint = useCallback(() => {
    const el = epicListRef.current
    if (!el) { setShowMoreHint(false); return }
    if (el.scrollHeight <= el.clientHeight + 2) { setShowMoreHint(false); return }
    setShowMoreHint(el.scrollHeight - el.scrollTop - el.clientHeight > 2)
  }, [])
  useEffect(() => { Promise.resolve().then(refreshHint) }, [epicList, refreshHint])

  /** Commit a single-field change (fires on blur / select change, not keystroke). */
  function commitField(ep: RecentEpic, field: 'title' | 'items' | 'priority', value: string | number) {
    onUpdateEpic({
      key: ep.key,
      custom: !!ep.custom,
      fields: { [field]: value },
      baseline: { title: ep.summary || '', items: baselineItems(ep) },
    })
  }

  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }

  const sortBtn = (key: SortKey, label: string, title?: string) => (
    <button type="button" className="inline-flex items-center gap-0.5 whitespace-nowrap hover:text-gray-600 dark:hover:text-gray-200" title={title} onClick={() => setSort(key)}>
      {label}
      <span className="inline-flex w-3 justify-center">
        {sortKey === key && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </span>
    </button>
  )

  const cellInputCls = 'bg-transparent px-1.5 py-0.5 border-0 rounded focus:outline-none focus:bg-blue-50/40 dark:focus:bg-blue-900/20'
  const numInputCls = 'w-14 text-[11px] text-right font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

  return (
    <section>
      <AppInfoPanel trigger={<h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Scope</h2>}>
        <div>
          <div className="font-semibold text-gray-800 dark:text-gray-200 mb-1">How it works</div>
          <ul className="space-y-1 list-disc list-inside">
            <li>The scope is built from <span className="font-medium">epics owned by the squad you picked in the sidebar</span>, pulled live from Jira. Epics whose <span className="font-medium">own status</span> is Done / Closed / Rejected / Delivered are excluded — they're already finished, no point planning them.</li>
            <li><span className="font-medium">Filter by key or summary</span> narrows the list. <span className="font-medium">Empty epics</span> (no child issues) are always hidden.</li>
            <li><span className="font-medium">Click a row</span> (or its colour square on the left) to add the epic to the planner. The square fills with the epic's Timeline colour once it's in.</li>
            <li>The <span className="font-medium">Priority</span> column shows each epic's Jira priority. Selected epics get a dropdown to override it for planning — this is what the Descope tweak (below the Timeline) uses to decide which epics to drop.</li>
            <li>The pinned <span className="font-medium">first row</span> creates <span className="font-medium">custom epics</span> for work that isn't in Jira yet — type a name, item count, and priority, then click <em>Add</em>. The key is auto-assigned (CUST-N) and they behave like real epics on the Timeline; the <span className="font-medium">×</span> on a custom row deletes it.</li>
            <li>The <span className="font-medium">"What counts as to do"</span> chip group decides which Jira statuses count toward the <span className="font-medium">To do</span> column — these are statuses on the <span className="font-medium">child issues</span> inside each epic, not the epic's own status. The number next to each chip is items in the current selection sitting in that status.</li>
            <li>The summary line below the table is what the Timeline will use: <span className="font-medium">N items in scope · M epics</span>.</li>
          </ul>
        </div>
      </AppInfoPanel>

      <div className="mt-3">
        {/* Options row */}
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <Search size={12} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
              placeholder="Filter by key or summary"
              className="w-64 px-2 py-1 rounded border border-gray-200 dark:border-slate-700 bg-transparent text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-400 dark:focus:border-blue-500"
            />
          </div>
          {Object.keys(statusInScope).length > 0 && (
            <button className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100" onClick={() => setStatusOpen((v) => !v)}>
              {statusOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="font-semibold">What counts as “to do”</span>
            </button>
          )}
        </div>

        {/* Item-status filter chips */}
        {statusOpen && Object.keys(statusInScope).length > 0 && (
          <div className="mt-2 pl-4">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(statusInScope).map(([name, on]) => (
                <button
                  key={name}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${on ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-400 line-through dark:bg-slate-800 dark:text-gray-500'}`}
                  onClick={() => onToggleStatus(name)}
                >
                  <span>{name}</span>
                  <span className="tabular-nums opacity-70">{statusCounts[name] || 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Epic list */}
        <div className="mt-3">
          <div className="relative">
            <div ref={epicListRef} onScroll={refreshHint} className="max-h-[210px] overflow-y-auto sidebar-scroll">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900 shadow-[inset_0_-1px_0_0_rgb(229_231_235_/_1)] dark:shadow-[inset_0_-1px_0_0_rgb(51_65_85_/_1)]">
                  <tr className="text-[10px] uppercase tracking-wide text-gray-400 select-none">
                    <th className="text-left py-1.5 pr-2 font-medium whitespace-nowrap">
                      <button type="button" className="inline-flex items-center gap-0.5 hover:text-gray-600 dark:hover:text-gray-200" title="Sort by selection (in-planner first)" onClick={() => setSort('selected')}>
                        Epics <span className="text-gray-400 tabular-nums">({epicList.length})</span>
                        <span className="inline-flex w-3 justify-center">{sortKey === 'selected' && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}</span>
                      </button>
                    </th>
                    <th className="text-left py-1.5 pr-2 font-medium">{sortBtn('key', 'Key')}</th>
                    <th className="text-left py-1.5 pr-2 font-medium">{sortBtn('title', 'Title')}</th>
                    <th className="text-right py-1.5 pr-2 font-medium">{sortBtn('todo', 'To do')}</th>
                    <th className="text-left py-1.5 pr-2 font-medium whitespace-nowrap">{sortBtn('priority', 'Priority', 'Sort by priority (Critical first)')}</th>
                    <th className="text-left py-1.5 pr-2 font-medium">{sortBtn('status', 'Epic status')}</th>
                    <th className="text-right py-1.5 pr-2 font-medium">{sortBtn('created', 'Created')}</th>
                    <th className="text-right py-1.5 pr-2 font-medium">{sortBtn('updated', 'Updated')}</th>
                    <th className="py-1.5 w-full" />
                  </tr>

                  {/* Always-visible "add custom epic" sub-header row */}
                  <tr className="border-t border-gray-100 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-800/40 align-middle">
                    <td className="py-1.5 pr-2" />
                    <td className="py-1.5 pr-2"><span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{nextCustomKey}</span></td>
                    <td className="py-1.5 pr-2 min-w-[360px]">
                      <input
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        onKeyUp={(e) => { if (e.key === 'Enter') submitCustom() }}
                        type="text" placeholder="Add custom epic…"
                        className={`w-full max-w-[360px] text-[11px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 ${cellInputCls}`}
                      />
                    </td>
                    <td className="py-1.5 pr-[22px] text-right tabular-nums">
                      <input
                        value={customItems}
                        onChange={(e) => setCustomItems(Number(e.target.value))}
                        onKeyUp={(e) => { if (e.key === 'Enter') submitCustom() }}
                        type="number" min={1} step={1} title="Number of items"
                        className={`${numInputCls} text-gray-800 dark:text-gray-100 ${cellInputCls}`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        value={customPriority}
                        onChange={(e) => setCustomPriority(e.target.value)}
                        title="Priority"
                        className={`text-[10px] font-medium pl-1 pr-0.5 py-0.5 border-0 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer appearance-none ${priorityCls(customPriority)}`}
                      >
                        {PRIORITY_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2" /><td className="py-1.5 pr-2" /><td className="py-1.5 pr-2" />
                    <td className="py-1.5">
                      <button
                        type="button" onClick={submitCustom}
                        disabled={!customName.trim() || customItems <= 0}
                        className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                      >Add</button>
                    </td>
                  </tr>
                </thead>
                <tbody>
                  {loadingEpicsFor === squad && !epicList.length ? (
                    <tr><td colSpan={9} className="py-3 text-xs text-gray-400"><span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading epics…</span></td></tr>
                  ) : !epicList.length ? (
                    <tr><td colSpan={9} className="py-3 text-xs text-gray-400">No epics match the current filters.</td></tr>
                  ) : (
                    epicList.map((ep) => {
                      const selected = isSelected(ep.key)
                      const effPriority = effectivePriority(ep)
                      const inScope = inScopeForEpic(ep)
                      return (
                        <tr key={ep.key} data-epic-key={ep.key} className="border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40">
                          <td className="py-1.5 pr-2 align-middle cursor-pointer" onClick={() => onToggleEpic(squad, ep)}>
                            <div className="flex items-center justify-center">
                              <span
                                className={`w-3.5 h-3.5 rounded-sm shrink-0 border transition-colors ${selected ? 'border-transparent' : 'bg-gray-200 dark:bg-slate-600 border-gray-300 dark:border-slate-500'}`}
                                style={selected ? { background: selectedColor(ep.key) || '#64748b' } : undefined}
                                title={selected ? 'In planner (Timeline colour)' : 'Add to planner'}
                              />
                            </div>
                          </td>
                          <td className="py-1.5 pr-2 align-middle whitespace-nowrap cursor-pointer" title={selected ? 'Click to remove from planner' : 'Click to add to planner'} onClick={() => onToggleEpic(squad, ep)}>
                            <span className="font-mono text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">{ep.key}</span>
                          </td>
                          <td className="py-1.5 pr-2 align-middle min-w-[360px]">
                            <input
                              key={`t-${effectiveTitle(ep)}`}
                              defaultValue={effectiveTitle(ep)}
                              onBlur={(e) => { if (e.target.value !== effectiveTitle(ep)) commitField(ep, 'title', e.target.value) }}
                              onKeyDown={blurOnEnter}
                              className={`w-full max-w-[360px] text-[11px] ${cellInputCls} ${titleOverridden(ep) ? OVR_BG : 'text-gray-700 dark:text-gray-300'}`}
                              title={titleOverridden(ep) ? OVR_TITLE : ''}
                            />
                          </td>
                          <td className="py-1.5 pr-[22px] text-right tabular-nums align-middle whitespace-nowrap">
                            <input
                              key={`i-${inScope}`}
                              defaultValue={inScope}
                              onBlur={(e) => {
                                const v = Math.max(0, Math.round(Number(e.target.value || 0)))
                                if (v !== inScope) commitField(ep, 'items', v)
                              }}
                              onKeyDown={blurOnEnter}
                              type="number" min={0} step={1}
                              className={`${numInputCls} ${cellInputCls} ${itemsOverridden(ep) ? OVR_BG : 'text-gray-800 dark:text-gray-100'}`}
                              title={itemsOverridden(ep) ? OVR_TITLE : ''}
                            />
                          </td>
                          <td className="py-1.5 pr-2 align-middle whitespace-nowrap">
                            <span className="inline-block relative">
                              <select
                                value={effPriority}
                                onChange={(e) => commitField(ep, 'priority', e.target.value)}
                                className={`text-[10px] font-medium pl-1 pr-0.5 py-0.5 border-0 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer appearance-none ${priorityCls(effPriority)}`}
                                title={priorityOverridden(ep) ? (ep.custom ? OVR_TITLE : `${OVR_TITLE} · Jira priority: ${ep.priority || '—'}`) : ''}
                              >
                                {PRIORITY_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                              </select>
                              {priorityOverridden(ep) && (
                                <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-yellow-400 dark:bg-yellow-500 ring-1 ring-white dark:ring-slate-900 pointer-events-none" aria-hidden="true" />
                              )}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 align-middle whitespace-nowrap">
                            {ep.custom
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">custom</span>
                              : ep.status
                                ? <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getTagProps('status', ep.status).cls}`}>{ep.status}</span>
                                : null}
                          </td>
                          <td className="py-1.5 pr-[22px] text-right text-[11px] text-gray-400 tabular-nums align-middle whitespace-nowrap">{ep.created || '—'}</td>
                          <td className="py-1.5 pr-[22px] text-right text-[11px] text-gray-400 tabular-nums align-middle whitespace-nowrap">{ep.updated || '—'}</td>
                          <td className="py-1.5 align-middle">
                            <div className="inline-flex items-center gap-1.5">
                              {ep.custom ? (
                                <button
                                  type="button"
                                  className="text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                                  title={`Delete ${ep.summary}`}
                                  onClick={(e) => { e.stopPropagation(); onRemoveCustomEpic(ep.key) }}
                                ><X size={15} /></button>
                              ) : jiraUrl ? (
                                <a
                                  href={`${jiraUrl.replace(/\/$/, '')}/browse/${ep.key}`} target="_blank" rel="noopener noreferrer"
                                  className="text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 p-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                  title={`Open ${ep.key} in Jira`}
                                  onClick={(e) => e.stopPropagation()}
                                ><ExternalLink size={14} /></a>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            {/* Fade hint: there's more below */}
            {showMoreHint && (
              <div className="absolute bottom-0 left-0 right-0 h-7 pointer-events-none bg-gradient-to-b from-transparent to-white dark:to-slate-900" />
            )}
          </div>
        </div>

        {/* In-scope summary */}
        <div className="mt-2 text-xs text-gray-500 tabular-nums">
          <span className="font-semibold text-gray-800 dark:text-gray-100">{includedItems}</span> items in scope
          <span className="text-gray-400 dark:text-gray-500"> · </span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">{summary.epics}</span> epics
        </div>
      </div>
    </section>
  )
})

export default PlannerScope
