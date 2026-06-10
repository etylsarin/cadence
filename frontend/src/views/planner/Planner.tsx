import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import PlannerSidebar from './PlannerSidebar'
import PlannerScope, { type PlannerScopeHandle } from './PlannerScope'
import PlannerTimeline from './PlannerTimeline'
import { simulate, EPIC_COLORS, countWorkdays, normalizePriority, ymd, type SimResult, type EpicInput } from './simulate'
import { useProject, PROJECTS as ALL_PROJECTS } from '@/hooks/useProject'
import type { PeriodSelection } from '@/lib/jql'
import type { TeamConfig, ScenarioOn, RecentEpic, SelectedEpic, EpicOverride, ReorderChange, EpicEditPayload, EpicChild } from './types'

const DEFAULT_EXCLUDED_STATUSES = new Set(['Delivered', 'Closed', 'Rejected', 'Done'])

interface EpicsResponse { epics: RecentEpic[] }
interface ChildrenResponse {
  epics: { key: string; children: EpicChild[]; status_breakdown: Record<string, number> }[]
  all_statuses: { name: string; count: number }[]
  jira_url?: string
}

export default function Planner() {
  const { project: squad, PROJECTS, set: setSquad } = useProject()

  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  // Period drives throughput + release-tail; sidebar's TimeframePicker emits the
  // initial selection on mount, triggering the first load.
  const [period, setPeriod] = useState<PeriodSelection | null>(null)

  // Per-squad team pace — average items/month from synced data, keyed by squad.
  const [teamConfig, setTeamConfig] = useState<Record<string, TeamConfig>>(() =>
    Object.fromEntries(ALL_PROJECTS.map((s) => [s, { id: s, name: s, throughputPerMonth: 0 }])),
  )

  const [throughputMeta, setThroughputMeta] = useState<{ as_of: string | null; months_used: string[]; months_excluded: string[] }>({ as_of: null, months_used: [], months_excluded: [] })

  const [recentEpicsByProject, setRecentEpicsByProject] = useState<Record<string, RecentEpic[]>>({})
  const [loadingEpicsFor, setLoadingEpicsFor] = useState<string | null>(null)

  const [selectedEpics, setSelectedEpics] = useState<SelectedEpic[]>([])
  const [loadingChildren, setLoadingChildren] = useState(false)
  const [jiraUrl, setJiraUrl] = useState('')

  const [statusInScope, setStatusInScope] = useState<Record<string, boolean>>({})

  const [scenarioOn, setScenarioOn] = useState<ScenarioOn>({
    extraCapacityPct: 0, excludeTypes: [], dropPriorities: [],
  })

  // Custom epics — placeholders for work not yet in Jira, keyed by squad.
  const [customEpics, setCustomEpics] = useState<Record<string, RecentEpic[]>>({})
  const customEpicSeq = useRef(0)
  const [nextCustomKey, setNextCustomKey] = useState('CUST-1')

  // Persistent per-epic edit overrides (Jira rows) — survives selection toggles.
  const [epicOverrides, setEpicOverrides] = useState<Record<string, EpicOverride>>({})

  const [globalError, setGlobalError] = useState<string | null>(null)

  const scopeRef = useRef<PlannerScopeHandle>(null)

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const countInScope = useCallback((epic: SelectedEpic, opts: { excludeTypes?: string[] | null; skipOverride?: boolean } = {}): number => {
    const { excludeTypes = null, skipOverride = false } = opts
    if (!skipOverride && epic.overrideItems != null) return Math.max(0, Number(epic.overrideItems))
    if (epic.custom) return Math.max(0, Number(epic.customItems || 0))
    if (!epic.children) return 0
    const excl = excludeTypes && excludeTypes.length ? new Set(excludeTypes) : null
    return epic.children.filter((c) => {
      if (!statusInScope[c.status]) return false
      if (excl && excl.has(c.type)) return false
      return true
    }).length
  }, [statusInScope])

  const epicsForSquad = useMemo(() => selectedEpics.filter((e) => e.project === squad), [selectedEpics, squad])

  const buildTeam = useCallback((opts: { extraCapacityPct?: number } = {}): TeamConfig => {
    const { extraCapacityPct = 0 } = opts
    const base = teamConfig[squad]
    return {
      id: base.id,
      name: base.name,
      throughputPerMonth: base.throughputPerMonth * (1 + extraCapacityPct / 100),
    }
  }, [teamConfig, squad])

  const buildEpics = useCallback((list: SelectedEpic[], opts: { excludeTypes?: string[] | null; dropPriorities?: string[] | null } = {}): EpicInput[] => {
    const { excludeTypes = null, dropPriorities = null } = opts
    const dropSet = dropPriorities && dropPriorities.length ? new Set(dropPriorities) : null
    return list.map((e, idx) => {
      const tier = e.priorityLevel || 'Medium'
      const dropped = !!dropSet && dropSet.has(tier)
      return {
        id: e.key,
        name: e.overrideTitle || e.summary || e.key,
        teamId: squad,
        items: dropped ? 0 : countInScope(e, { excludeTypes }),
        color: e.color,
        priority: idx + 1,
        priorityLevel: tier,
        earliestStartWorkday: Math.max(0, Number(e.earliestStartWorkday || 0)),
        laneIndex: Math.max(0, Number(e.laneIndex || 0)),
      }
    })
  }, [squad, countInScope])

  const baselineStart = useMemo(() => new Date(startDate + 'T00:00:00'), [startDate])

  const baseline = useMemo<SimResult | null>(() => {
    if (!epicsForSquad.length) return null
    return simulate({ teams: [buildTeam()], epics: buildEpics(epicsForSquad), start: baselineStart, focusMode: 'parallel' })
  }, [epicsForSquad, buildTeam, buildEpics, baselineStart])

  const scenario = useMemo<SimResult | null>(() => {
    if (!epicsForSquad.length) return null
    return simulate({
      teams: [buildTeam({ extraCapacityPct: scenarioOn.extraCapacityPct })],
      epics: buildEpics(epicsForSquad, { excludeTypes: scenarioOn.excludeTypes, dropPriorities: scenarioOn.dropPriorities }),
      start: baselineStart,
      focusMode: 'parallel',
    })
  }, [epicsForSquad, buildTeam, buildEpics, baselineStart, scenarioOn])

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    api<{ jira_url?: string }>('/api/config').then((d) => setJiraUrl(d.jira_url || '')).catch(() => { /* non-fatal */ })
  }, [])

  /** Serialise a Flow-Metrics-shaped period payload into query params. */
  function periodParams(p: PeriodSelection): string {
    const params = new URLSearchParams({ gran: p.gran })
    for (const y of p.years || []) params.append('years', String(y))
    for (const v of p.periods || []) params.append('periods', v)
    return params.toString()
  }

  const onPeriodChange = useCallback((p: PeriodSelection) => {
    setPeriod(p)
    // Throughput: rolling items/month per squad over the selected window.
    api<{ as_of: string | null; months_used?: string[]; months_excluded?: string[]; items_per_month?: Record<string, number> }>(`/planner/api/throughput?${periodParams(p)}`)
      .then((res) => {
        setThroughputMeta({ as_of: res.as_of, months_used: res.months_used || [], months_excluded: res.months_excluded || [] })
        setTeamConfig((prev) => {
          const next = { ...prev }
          for (const s of ALL_PROJECTS) {
            const v = res.items_per_month?.[s]
            if (typeof v === 'number') next[s] = { ...next[s], throughputPerMonth: Math.round(v) }
          }
          return next
        })
      })
      .catch((e) => setGlobalError(`Throughput: ${(e as Error).message}`))
  }, [])

  // Auto-load epics for the selected squad.
  useEffect(() => {
    if (!squad || recentEpicsByProject[squad]) return
    let cancelled = false
    setLoadingEpicsFor(squad)
    api<EpicsResponse>(`/planner/api/epics?project=${encodeURIComponent(squad)}&limit=50`)
      .then((res) => {
        if (cancelled) return
        setRecentEpicsByProject((prev) => ({ ...prev, [squad]: res.epics || [] }))
        // Seed statusInScope from the per-epic breakdowns so the To-do count +
        // Status filter populate before any epic is selected.
        setStatusInScope((prev) => {
          const next = { ...prev }
          for (const ep of res.epics || []) {
            for (const status of Object.keys(ep.child_status_counts || {})) {
              if (!(status in next)) next[status] = !DEFAULT_EXCLUDED_STATUSES.has(status)
            }
          }
          return next
        })
      })
      .catch((e) => { if (!cancelled) setGlobalError(`Epics ${squad}: ${(e as Error).message}`) })
      .finally(() => { if (!cancelled) setLoadingEpicsFor(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squad])

  // ── Selection ───────────────────────────────────────────────────────────────

  /** Palette colour least used by this squad's selection (unused first). */
  const nextColor = useCallback((project: string, selection: SelectedEpic[]): string => {
    const counts = new Map(EPIC_COLORS.map((c) => [c, 0]))
    for (const e of selection) {
      if (e.project === project && counts.has(e.color)) counts.set(e.color, counts.get(e.color)! + 1)
    }
    let best = EPIC_COLORS[0]
    let bestN = Infinity
    for (const c of EPIC_COLORS) {
      const n = counts.get(c)!
      if (n < bestN) { best = c; bestN = n }
    }
    return best
  }, [])

  /** Default a new epic's start to just after the squad's existing work. */
  const nextSlotWorkdayForSquad = useCallback((s: string): number => {
    if (!baseline) return 0
    const tp = baseline.teamPlans.find((t) => t.teamId === s)
    if (!tp || !tp.rows.length) return 0
    const latestEnd = new Date(Math.max(...tp.rows.map((r) => r.plannedEnd.getTime())))
    return countWorkdays(baselineStart, latestEnd)
  }, [baseline, baselineStart])

  const refreshChildren = useCallback(async (keys: string[]) => {
    if (!keys.length) return
    setLoadingChildren(true)
    try {
      const res = await api<ChildrenResponse>('/planner/api/epic-children', { method: 'POST', body: JSON.stringify({ epic_keys: keys }) })
      const byKey: Record<string, { children: EpicChild[]; status_breakdown: Record<string, number> }> = {}
      for (const e of res.epics || []) byKey[e.key] = e
      setSelectedEpics((prev) => prev.map((e) => (byKey[e.key] ? { ...e, children: byKey[e.key].children, status_breakdown: byKey[e.key].status_breakdown } : e)))
      setStatusInScope((prev) => {
        const next = { ...prev }
        for (const s of res.all_statuses || []) {
          if (!(s.name in next)) next[s.name] = !DEFAULT_EXCLUDED_STATUSES.has(s.name)
        }
        return next
      })
    } catch (e) {
      console.warn('epic-children load failed:', (e as Error).message)
    } finally {
      setLoadingChildren(false)
    }
  }, [])

  const toggleEpic = useCallback(async (project: string, epic: RecentEpic) => {
    const existing = selectedEpics.findIndex((e) => e.key === epic.key)
    if (existing >= 0) {
      setSelectedEpics((prev) => prev.filter((e) => e.key !== epic.key))
      return
    }
    // Hydrate overrides so a re-checked Jira epic comes back with edits intact.
    const ovr = epicOverrides[epic.key] || {}
    const defaultPriority = epic.custom ? epic.priorityLevel || 'Medium' : normalizePriority(epic.priority)
    const entry: SelectedEpic = {
      key: epic.key,
      summary: epic.summary,
      project,
      color: nextColor(project, selectedEpics),
      children: [],
      status_breakdown: {},
      priorityLevel: ovr.priorityLevel || defaultPriority,
      overrideTitle: ovr.overrideTitle,
      overrideItems: ovr.overrideItems,
      earliestStartWorkday: nextSlotWorkdayForSquad(project),
      laneIndex: 0,
      custom: !!epic.custom,
      customItems: epic.custom ? Math.max(0, Number(epic.customItems || 0)) : undefined,
    }
    const next = [...selectedEpics, entry]
    setSelectedEpics(next)
    if (!epic.custom) await refreshChildren(next.filter((e) => !e.custom).map((e) => e.key))
  }, [selectedEpics, epicOverrides, nextColor, nextSlotWorkdayForSquad, refreshChildren])

  const customEpicsForSquad = customEpics[squad] || []

  const addCustomEpic = useCallback(({ name, items, priority }: { name: string; items: number; priority: string }) => {
    const project = squad
    const summary = (name || '').trim() || 'Custom epic'
    const count = Math.max(0, Math.round(Number(items || 0)))
    customEpicSeq.current += 1
    const key = `CUST-${customEpicSeq.current}`
    setNextCustomKey(`CUST-${customEpicSeq.current + 1}`)
    const epic: RecentEpic = { key, summary, custom: true, customItems: count, child_count: count, priorityLevel: normalizePriority(priority) }
    setCustomEpics((prev) => ({ ...prev, [project]: [epic, ...(prev[project] || [])] }))
    void toggleEpic(project, epic)   // select it immediately (custom → no children fetch)
    scopeRef.current?.resetSortForNew()
  }, [squad, toggleEpic])

  const removeCustomEpic = useCallback((key: string) => {
    setSelectedEpics((prev) => prev.filter((e) => e.key !== key))
    setCustomEpics((prev) => ({ ...prev, [squad]: (prev[squad] || []).filter((e) => e.key !== key) }))
  }, [squad])

  const toggleStatus = useCallback((name: string) => {
    setStatusInScope((prev) => ({ ...prev, [name]: !prev[name] }))
  }, [])

  /** Set an epic's priority tier — persists in the override map too. */
  const setPriority = useCallback((key: string, level: string) => {
    setSelectedEpics((prev) => prev.map((e) => (e.key === key ? { ...e, priorityLevel: level } : e)))
    setEpicOverrides((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), priorityLevel: level } }))
    setCustomEpics((prev) => {
      let changed = false
      const next: Record<string, RecentEpic[]> = {}
      for (const [proj, list] of Object.entries(prev)) {
        if (list.some((e) => e.key === key)) {
          next[proj] = list.map((e) => (e.key === key ? { ...e, priorityLevel: level } : e))
          changed = true
        } else next[proj] = list
      }
      return changed ? next : prev
    })
  }, [])

  /** Commit a row's edit-mode changes from the Scope table. */
  const updateEpic = useCallback(({ key, custom, fields, baseline: base }: EpicEditPayload) => {
    const hasTitle = fields.title !== undefined
    const hasItems = fields.items !== undefined
    const hasPriority = fields.priority !== undefined

    if (custom) {
      setSelectedEpics((prev) => prev.map((e) => {
        if (e.key !== key) return e
        const next = { ...e }
        if (hasTitle) next.summary = fields.title!
        if (hasItems) next.customItems = Number(fields.items)
        return next
      }))
      setCustomEpics((prev) => {
        const next: Record<string, RecentEpic[]> = {}
        for (const [proj, list] of Object.entries(prev)) {
          next[proj] = list.map((c) => {
            if (c.key !== key) return c
            const n = { ...c }
            if (hasTitle) n.summary = fields.title!
            if (hasItems) { n.customItems = Number(fields.items); n.child_count = Number(fields.items) }
            return n
          })
        }
        return next
      })
      if (hasPriority) setPriority(key, fields.priority!)
      return
    }

    // Jira rows: persist overrides only when the value truly diverges.
    setEpicOverrides((prev) => {
      const cur = { ...(prev[key] || {}) }
      if (hasTitle) {
        if (fields.title && fields.title !== base.title) cur.overrideTitle = fields.title
        else delete cur.overrideTitle
      }
      if (hasItems) {
        if (Number(fields.items) !== base.items) cur.overrideItems = Number(fields.items)
        else delete cur.overrideItems
      }
      if (hasPriority) cur.priorityLevel = fields.priority
      if (Object.keys(cur).length > 0) return { ...prev, [key]: cur }
      const { [key]: _removed, ...rest } = prev
      return rest
    })
    setSelectedEpics((prev) => prev.map((e) => {
      if (e.key !== key) return e
      const next = { ...e }
      if (hasTitle) next.overrideTitle = fields.title && fields.title !== base.title ? fields.title : undefined
      if (hasItems) next.overrideItems = Number(fields.items) !== base.items ? Number(fields.items) : undefined
      if (hasPriority && fields.priority) next.priorityLevel = fields.priority
      return next
    }))
  }, [setPriority])

  /** Apply a new plan start date, clamped to today. */
  const setStartDateClamped = useCallback((v: string) => {
    if (!v) return
    const today = ymd(new Date())
    setStartDate(v < today ? today : v)
  }, [])

  // ── Drag / reorder ──────────────────────────────────────────────────────────

  /** Pure: move `epicKey` to a new priority slot / start / lane within its squad. */
  const applyReorder = useCallback((epics: SelectedEpic[], { epicKey, targetIndexInSquad, earliestStartWorkday, laneIndex }: ReorderChange): SelectedEpic[] => {
    const list = epics.map((e) => ({ ...e }))
    const fromIdx = list.findIndex((e) => e.key === epicKey)
    if (fromIdx < 0) return list
    const [epic] = list.splice(fromIdx, 1)
    if (earliestStartWorkday != null) epic.earliestStartWorkday = Math.max(0, Math.floor(earliestStartWorkday))
    if (laneIndex != null) epic.laneIndex = Math.max(0, Math.floor(laneIndex))

    const tid = epic.project
    let seen = 0
    let insertAt = list.length
    for (let i = 0; i < list.length; i++) {
      if (list[i].project === tid) {
        if (seen === targetIndexInSquad) { insertAt = i; break }
        seen += 1
      }
    }
    list.splice(insertAt, 0, epic)

    // Compact this squad's laneIndex values to consecutive 0..N.
    const inSquad = list.filter((e) => e.project === tid)
    const used = [...new Set(inSquad.map((e) => Math.max(0, e.laneIndex || 0)))].sort((a, b) => a - b)
    const remap = new Map(used.map((v, i) => [v, i]))
    for (const e of list) {
      if (e.project === tid) e.laneIndex = remap.get(Math.max(0, e.laneIndex || 0)) ?? 0
    }
    return list
  }, [])

  /** Close the gap a moved/removed epic leaves in its source lane. */
  const collapseVacatedGap = useCallback((epics: SelectedEpic[], epicKey: string, targetLane: number | null = null): SelectedEpic[] => {
    const tp = (baseline?.teamPlans || []).find((t) => t.teamId === squad)
    const movedRow = tp?.rows.find((r) => r.epicId === epicKey)
    if (!movedRow) return epics
    const sourceLane = Math.max(0, Number(movedRow.laneIndex || 0))
    if (targetLane != null && Math.max(0, Math.floor(targetLane)) === sourceLane) return epics
    const dur = Number(movedRow.durationWorkdays || 0)
    if (dur <= 0) return epics
    const movedStart = movedRow.plannedStart.getTime()
    const downstream = new Set(
      tp!.rows
        .filter((r) => r.epicId !== epicKey && Math.max(0, Number(r.laneIndex || 0)) === sourceLane && r.plannedStart.getTime() >= movedStart)
        .map((r) => r.epicId),
    )
    if (!downstream.size) return epics
    return epics.map((e) => (downstream.has(e.key)
      ? { ...e, earliestStartWorkday: Math.max(0, Math.floor(Number(e.earliestStartWorkday || 0)) - dur) }
      : e))
  }, [baseline, squad])

  // Live drag preview: re-simulate with the proposed placement.
  const [dragPreview, setDragPreview] = useState<ReorderChange | null>(null)

  const previewBaseline = useMemo<SimResult | null>(() => {
    if (!dragPreview) return null
    const collapsed = collapseVacatedGap(selectedEpics, dragPreview.epicKey, dragPreview.laneIndex ?? null)
    const list = applyReorder(collapsed, dragPreview).filter((e) => e.project === squad)
    if (!list.length) return null
    return simulate({ teams: [buildTeam()], epics: buildEpics(list), start: baselineStart, focusMode: 'parallel' })
  }, [dragPreview, collapseVacatedGap, applyReorder, selectedEpics, squad, buildTeam, buildEpics, baselineStart])

  const reorder = useCallback((change: ReorderChange) => {
    setDragPreview(null)
    setSelectedEpics((prev) => {
      if (prev.findIndex((e) => e.key === change.epicKey) < 0) return prev
      const collapsed = collapseVacatedGap(prev, change.epicKey, change.laneIndex ?? null)
      return applyReorder(collapsed, change)
    })
  }, [collapseVacatedGap, applyReorder])

  const removeEpic = useCallback((epicKey: string) => {
    setDragPreview(null)
    setSelectedEpics((prev) => {
      if (prev.findIndex((e) => e.key === epicKey) < 0) return prev
      return collapseVacatedGap(prev, epicKey, null).filter((e) => e.key !== epicKey)
    })
  }, [collapseVacatedGap])

  /** One-click layout helpers for the selected squad. */
  const applyLayout = useCallback((kind: 'split' | 'sequential' | 'tighten') => {
    setSelectedEpics((prev) => {
      let i = 0
      return prev.map((e) => {
        if (e.project !== squad) return e
        if (kind === 'split') return { ...e, earliestStartWorkday: 0, laneIndex: i++ }
        if (kind === 'sequential') return { ...e, earliestStartWorkday: 0, laneIndex: 0 }
        return { ...e, earliestStartWorkday: 0 }   // tighten
      })
    })
  }, [squad])

  // Keep `period` referenced (parity with the Vue version's reactive use).
  void period

  return (
    <div className="fixed inset-0 flex bg-white dark:bg-slate-900">
      <PlannerSidebar
        squad={squad}
        squads={PROJECTS}
        asOf={throughputMeta.as_of}
        monthsUsed={throughputMeta.months_used?.length || 0}
        monthsExcluded={throughputMeta.months_excluded?.length || 0}
        onSquadChange={setSquad}
        onPeriodChange={onPeriodChange}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-7 space-y-14">
          {globalError && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{globalError}</div>
          )}

          <PlannerScope
            ref={scopeRef}
            squad={squad}
            recentEpicsByProject={recentEpicsByProject}
            customEpics={customEpicsForSquad}
            nextCustomKey={nextCustomKey}
            loadingEpicsFor={loadingEpicsFor}
            selectedEpics={selectedEpics}
            epicOverrides={epicOverrides}
            statusInScope={statusInScope}
            loadingChildren={loadingChildren}
            jiraUrl={jiraUrl}
            onToggleEpic={(project, epic) => void toggleEpic(project, epic)}
            onToggleStatus={toggleStatus}
            onAddCustomEpic={addCustomEpic}
            onRemoveCustomEpic={removeCustomEpic}
            onUpdateEpic={updateEpic}
          />

          <PlannerTimeline
            squad={squad}
            team={teamConfig[squad]}
            startDate={startDate}
            baseline={baseline}
            scenario={scenario}
            previewBaseline={previewBaseline}
            scenarioOn={scenarioOn}
            onScenarioOnChange={setScenarioOn}
            onStartDateChange={setStartDateClamped}
            onDragPreview={setDragPreview}
            onReorder={reorder}
            onRemove={removeEpic}
            onLayout={applyLayout}
          />
        </div>
      </div>
    </div>
  )
}
