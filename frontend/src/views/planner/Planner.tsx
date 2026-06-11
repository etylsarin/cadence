import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import PlannerSidebar from './PlannerSidebar'
import PlannerScope from './PlannerScope'
import PlannerTimeline from './PlannerTimeline'
import { simulate, autoOrderEpics, EPIC_COLORS, countWorkdays, normalizePriority, ymd, type SimResult, type EpicInput } from './simulate'
import { useProject, PROJECTS as ALL_PROJECTS } from '@/hooks/useProject'
import type { PeriodSelection } from '@/lib/jql'
import type { TeamConfig, RecentEpic, SelectedEpic, EpicOverride, ReorderChange, EpicEditPayload, EpicChild } from './types'

const DEFAULT_EXCLUDED_STATUSES = new Set(['Delivered', 'Closed', 'Rejected', 'Done'])

interface EpicsResponse { epics: RecentEpic[] }
interface ChildrenResponse {
  epics: { key: string; children: EpicChild[]; status_breakdown: Record<string, number> }[]
  all_statuses: { name: string; count: number }[]
  jira_url?: string
}

export default function Planner() {
  const { project: squad, PROJECTS: squadList, set: setSquad } = useProject()

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


  // Persistent per-epic edit overrides (Jira rows) — survives selection toggles.
  const [epicOverrides, setEpicOverrides] = useState<Record<string, EpicOverride>>({})

  const [globalError, setGlobalError] = useState<string | null>(null)
  const [depWarning, setDepWarning] = useState<{ ticket: string; epic: string }[]>([])
  const [autoAddedInfo, setAutoAddedInfo] = useState<string[]>([])

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const countInScope = useCallback((epic: SelectedEpic): number => {
    if (epic.overrideItems != null) return Math.max(0, Number(epic.overrideItems))
    if (!epic.children) return 0
    return epic.children.filter((c) => statusInScope[c.status]).length
  }, [statusInScope])

  const isAllProjects = squad === 'ALL'

  const timelineTeam = useMemo<TeamConfig>(() => {
    if (!isAllProjects) return teamConfig[squad] ?? { id: squad, name: squad, throughputPerMonth: 0 }
    const total = ALL_PROJECTS.reduce((sum, p) => sum + (teamConfig[p]?.throughputPerMonth ?? 0), 0)
    return { id: 'ALL', name: 'All Projects', throughputPerMonth: total }
  }, [isAllProjects, teamConfig, squad])

  const epicsForSquad = useMemo(
    () => isAllProjects ? selectedEpics : selectedEpics.filter((e) => e.project === squad),
    [selectedEpics, squad, isAllProjects],
  )

  const buildTeams = useCallback((): TeamConfig[] => {
    if (isAllProjects) return ALL_PROJECTS.map((p) => teamConfig[p]).filter(Boolean)
    const t = teamConfig[squad]
    return t ? [t] : []
  }, [teamConfig, squad, isAllProjects])

  const buildEpics = useCallback((list: SelectedEpic[]): EpicInput[] => {
    return list.map((e, idx) => ({
      id: e.key,
      name: e.overrideTitle || e.summary || e.key,
      teamId: e.project,
      items: countInScope(e),
      color: e.color,
      priority: idx + 1,
      priorityLevel: e.priorityLevel || 'Medium',
      earliestStartWorkday: Math.max(0, Number(e.earliestStartWorkday || 0)),
      laneIndex: Math.max(0, Number(e.laneIndex || 0)),
    }))
  }, [countInScope])

  const baselineStart = useMemo(() => new Date(startDate + 'T00:00:00'), [startDate])

  const baseline = useMemo<SimResult | null>(() => {
    const teams = buildTeams()
    if (!epicsForSquad.length || !teams.length) return null
    return simulate({ teams, epics: buildEpics(epicsForSquad), start: baselineStart, focusMode: 'parallel' })
  }, [epicsForSquad, buildTeams, buildEpics, baselineStart])

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

  // Auto-load epics for the selected squad (or all projects when squad='ALL').
  useEffect(() => {
    if (!squad) return
    // Determine which projects still need loading.
    const toLoad = isAllProjects
      ? ALL_PROJECTS.filter((p) => !recentEpicsByProject[p])
      : recentEpicsByProject[squad] ? [] : [squad]
    if (!toLoad.length) return

    let cancelled = false
    setLoadingEpicsFor(isAllProjects ? 'ALL' : squad)

    Promise.all(toLoad.map((p) =>
      api<EpicsResponse>(`/planner/api/epics?project=${encodeURIComponent(p)}&limit=50`)
        .then((res) => ({ project: p, epics: res.epics || [] })),
    ))
      .then((results) => {
        if (cancelled) return
        setRecentEpicsByProject((prev) => {
          const next = { ...prev }
          for (const { project: p, epics } of results) next[p] = epics
          return next
        })
        setStatusInScope((prev) => {
          const next = { ...prev }
          for (const { epics } of results) {
            for (const ep of epics) {
              for (const status of Object.keys(ep.child_status_counts || {})) {
                if (!(status in next)) next[status] = !DEFAULT_EXCLUDED_STATUSES.has(status)
              }
            }
          }
          return next
        })
      })
      .catch((e) => { if (!cancelled) setGlobalError(`Epics: ${(e as Error).message}`) })
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

  // Latest-value refs so refreshChildren (stable callback) can read current data.
  const recentEpicsRef = useRef(recentEpicsByProject)
  recentEpicsRef.current = recentEpicsByProject
  const epicOverridesRef = useRef(epicOverrides)
  epicOverridesRef.current = epicOverrides

  const refreshChildren = useCallback(async (keys: string[]) => {
    if (!keys.length) return
    setLoadingChildren(true)
    try {
      const res = await api<ChildrenResponse>('/planner/api/epic-children', { method: 'POST', body: JSON.stringify({ epic_keys: keys }) })
      const byKey: Record<string, { children: EpicChild[]; status_breakdown: Record<string, number> }> = {}
      for (const e of res.epics || []) byKey[e.key] = e

      let latestEpics: SelectedEpic[] = []
      setSelectedEpics((prev) => {
        const updated = prev.map((e) => (byKey[e.key] ? { ...e, children: byKey[e.key].children, status_breakdown: byKey[e.key].status_breakdown } : e))
        latestEpics = autoOrderEpics(updated)
        return latestEpics
      })

      // Detect external blocking dependencies: ticket keys referenced in blocks/blocked_by
      // that don't belong to any currently selected epic.
      const knownTickets = new Set(latestEpics.flatMap((e) => e.children.map((c) => c.key)))
      const external = new Set<string>()
      for (const epic of latestEpics) {
        for (const child of epic.children) {
          for (const ref of [...(child.blocks ?? []), ...(child.blocked_by ?? [])]) {
            if (!knownTickets.has(ref)) external.add(ref)
          }
        }
      }
      if (external.size) {
        try {
          const ticketEpics = await api<Record<string, string>>(
            `/planner/api/ticket-epics?${[...external].map((k) => `keys=${encodeURIComponent(k)}`).join('&')}`,
          )
          const selectedEpicKeys = new Set(latestEpics.map((e) => e.key))
          const allMissing = Object.entries(ticketEpics)
            .filter(([, epicKey]) => !selectedEpicKeys.has(epicKey))
            .map(([ticket, epic]) => ({ ticket, epic }))
          const uniqueMissing = [...new Map(allMissing.map((w) => [w.epic, w])).values()]

          const getProj = (k: string) => k.split('-')[0]
          const selectedProjects = new Set(latestEpics.map((e) => e.project))
          const toAutoAdd: SelectedEpic[] = []
          const cantAdd: { ticket: string; epic: string }[] = []

          for (const { epic: epicKey } of uniqueMissing) {
            const p = getProj(epicKey)
            const meta = recentEpicsRef.current[p]?.find((e) => e.key === epicKey)
            if (selectedProjects.has(p) && meta) {
              const ovr = epicOverridesRef.current[epicKey] || {}
              toAutoAdd.push({
                key: epicKey,
                summary: meta.summary,
                project: p,
                // eslint-disable-next-line react-hooks/exhaustive-deps
                color: nextColor(p, [...latestEpics, ...toAutoAdd]),
                children: [],
                status_breakdown: {},
                priorityLevel: ovr.priorityLevel || normalizePriority(meta.priority),
                overrideTitle: ovr.overrideTitle,
                overrideItems: ovr.overrideItems,
                earliestStartWorkday: 0,
                laneIndex: latestEpics.length + toAutoAdd.length,
                custom: false,
              })
            } else {
              cantAdd.push({ ticket: allMissing.find((w) => w.epic === epicKey)?.ticket ?? epicKey, epic: epicKey })
            }
          }

          if (toAutoAdd.length > 0) {
            setAutoAddedInfo((prev) => [...new Set([...prev, ...toAutoAdd.map((e) => e.key)])])
            // Load children for original + newly added epics.
            const res2 = await api<ChildrenResponse>('/planner/api/epic-children', {
              method: 'POST',
              body: JSON.stringify({ epic_keys: [...new Set([...keys, ...toAutoAdd.map((e) => e.key)])] }),
            })
            const byKey2: Record<string, { children: EpicChild[]; status_breakdown: Record<string, number> }> = {}
            for (const e of res2.epics || []) byKey2[e.key] = e
            // Single functional update so we compose on top of whatever state React
            // has committed (including the user's concurrently toggled epic).
            setSelectedEpics((prev) => {
              const have = new Set(prev.map((e) => e.key))
              const toAdd = toAutoAdd.filter((e) => !have.has(e.key))
              return autoOrderEpics([...prev, ...toAdd].map((e) => byKey2[e.key] ? { ...e, children: byKey2[e.key].children, status_breakdown: byKey2[e.key].status_breakdown } : e))
            })
            setStatusInScope((prev) => {
              const next = { ...prev }
              for (const s of res2.all_statuses || []) if (!(s.name in next)) next[s.name] = !DEFAULT_EXCLUDED_STATUSES.has(s.name)
              return next
            })
          }

          setDepWarning(cantAdd)
        } catch { /* non-fatal */ }
      } else {
        setDepWarning([])
      }

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
    const defaultPriority = normalizePriority(epic.priority)
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
      custom: false,
    }
    const next = [...selectedEpics, entry]
    setSelectedEpics(next)
    await refreshChildren(next.map((e) => e.key))
  }, [selectedEpics, epicOverrides, nextColor, nextSlotWorkdayForSquad, refreshChildren])

  const toggleStatus = useCallback((name: string) => {
    setStatusInScope((prev) => ({ ...prev, [name]: !prev[name] }))
  }, [])

  /** Set an epic's priority tier — persists in the override map too. */
  const setPriority = useCallback((key: string, level: string) => {
    setSelectedEpics((prev) => prev.map((e) => (e.key === key ? { ...e, priorityLevel: level } : e)))
    setEpicOverrides((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), priorityLevel: level } }))
  }, [])

  /** Commit a row's edit-mode changes from the Scope table. */
  const updateEpic = useCallback(({ key, fields, baseline: base }: EpicEditPayload) => {
    const hasTitle = fields.title !== undefined
    const hasItems = fields.items !== undefined
    const hasPriority = fields.priority !== undefined

    // Persist overrides only when the value truly diverges.
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
    const list = applyReorder(collapsed, dragPreview).filter((e) => isAllProjects || e.project === squad)
    const teams = buildTeams()
    if (!list.length || !teams.length) return null
    return simulate({ teams, epics: buildEpics(list), start: baselineStart, focusMode: 'parallel' })
  }, [dragPreview, collapseVacatedGap, applyReorder, selectedEpics, squad, isAllProjects, buildTeams, buildEpics, baselineStart])

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

  /** Set overrideItems on a timeline bar resize. */
  const resizeEpic = useCallback((epicKey: string, newItems: number) => {
    setEpicOverrides((prev) => ({ ...prev, [epicKey]: { ...(prev[epicKey] || {}), overrideItems: newItems } }))
    setSelectedEpics((prev) => prev.map((e) => (e.key === epicKey ? { ...e, overrideItems: newItems } : e)))
  }, [])

  // Keep `period` referenced (parity with the Vue version's reactive use).
  void period

  return (
    <div className="fixed inset-0 flex bg-white dark:bg-slate-900">
      <PlannerSidebar
        squad={squad}
        squads={squadList}
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
          {(autoAddedInfo.length > 0 || depWarning.length > 0) && (
            <div className="flex flex-col gap-2">
              {autoAddedInfo.length > 0 && (
                <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300 text-xs flex items-start gap-2">
                  <span className="shrink-0 font-semibold mt-0.5">Auto-added</span>
                  <span className="flex-1">
                    {autoAddedInfo.join(', ')} {autoAddedInfo.length === 1 ? 'was' : 'were'} automatically added to the board — {autoAddedInfo.length === 1 ? 'it has' : 'they have'} blocking dependencies with other epics in your plan.
                  </span>
                  <button className="shrink-0 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-200 font-medium" onClick={() => setAutoAddedInfo([])}>Dismiss</button>
                </div>
              )}
              {depWarning.length > 0 && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
                  <span className="shrink-0 font-semibold mt-0.5">Cross-project dependencies</span>
                  <span className="flex-1">
                    {depWarning.map((w) => w.epic).join(', ')} {depWarning.length === 1 ? 'is' : 'are'} in a different project and cannot be added automatically, but {depWarning.length === 1 ? 'has' : 'have'} tickets that block or are blocked by tickets in this plan.
                  </span>
                  <button className="shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 font-medium" onClick={() => setDepWarning([])}>Dismiss</button>
                </div>
              )}
            </div>
          )}

          <PlannerScope
            squad={squad}
            recentEpicsByProject={recentEpicsByProject}
            loadingEpicsFor={loadingEpicsFor}
            selectedEpics={selectedEpics}
            epicOverrides={epicOverrides}
            statusInScope={statusInScope}
            loadingChildren={loadingChildren}
            jiraUrl={jiraUrl}
            onToggleEpic={(project, epic) => void toggleEpic(project, epic)}
            onToggleStatus={toggleStatus}
            onUpdateEpic={updateEpic}
          />

          <PlannerTimeline
            squad={squad}
            team={timelineTeam}
            startDate={startDate}
            baseline={baseline}
            previewBaseline={previewBaseline}
            onStartDateChange={setStartDateClamped}
            onDragPreview={setDragPreview}
            onReorder={reorder}
            onRemove={removeEpic}
            onResizeEpic={resizeEpic}
          />
        </div>
      </div>
    </div>
  )
}
