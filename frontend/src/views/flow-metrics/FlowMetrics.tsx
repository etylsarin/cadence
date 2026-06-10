import { useEffect, useMemo, useState } from 'react'
import FlowSidebar, { FLOW_TYPES } from './FlowSidebar'
import StageTable from './StageTable'
import TrendChart from './TrendChart'
import AgingTable from './AgingTable'
import DrillDrawer from '@/components/DrillDrawer'
import EmptyState from '@/components/EmptyState'
import TagBadge from '@/components/TagBadge'
import { api } from '@/lib/api'
import { PROJECTS, useProject } from '@/hooks/useProject'
import type { PeriodSelection } from '@/lib/jql'
import type { AgingData, FlowData, StageStat } from './types'

function fmtDays(d: number | null | undefined): string {
  return d == null ? '—' : d.toFixed(1)
}

function buildQuery(project: string, period: PeriodSelection, types: string[]): string {
  const qs = new URLSearchParams({ project, gran: period.gran })
  for (const y of period.years) qs.append('years', String(y))
  for (const p of period.periods) qs.append('periods', p)
  for (const t of types) qs.append('types', t)
  return qs.toString()
}

export default function FlowMetrics() {
  const { project, set: setProject } = useProject()
  const [period, setPeriod]   = useState<PeriodSelection | null>(null)
  const [types, setTypes]     = useState<string[]>(FLOW_TYPES)

  const [flow, setFlow]       = useState<FlowData | null>(null)
  const [aging, setAging]     = useState<AgingData | null>(null)
  const [agingError, setAgingError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [drillOpen, setDrillOpen]   = useState(false)
  const [drillStage, setDrillStage] = useState<StageStat | null>(null)

  // Completed-flow summary — refetch on any selection change.
  useEffect(() => {
    if (!period) return
    let cancelled = false
    setLoading(true); setError('')
    api<FlowData>(`/flow-metrics/api/flow?${buildQuery(project, period, types)}`)
      .then((d) => { if (!cancelled) setFlow(d) })
      .catch((e) => { if (!cancelled) { setFlow(null); setError((e as Error).message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project, period, types])

  // Aging WIP — timeframe-independent (it's about *open* work).
  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ project })
    for (const t of types) qs.append('types', t)
    api<AgingData>(`/flow-metrics/api/aging?${qs.toString()}`)
      .then((d) => { if (!cancelled) { setAging(d); setAgingError('') } })
      .catch((e) => { if (!cancelled) { setAging(null); setAgingError((e as Error).message) } })
    return () => { cancelled = true }
  }, [project, types])

  const periodLabel = useMemo(() => {
    const months = flow?.months_used ?? []
    if (!months.length) return ''
    return months.length === 1 ? months[0] : `${months[0]} – ${months[months.length - 1]}`
  }, [flow])

  // Drill rows: completed issues sorted by the focused stage (or cycle time).
  const drillRows = useMemo(() => {
    const issues = [...(flow?.issues ?? [])]
    issues.sort((a, b) => drillStage
      ? (b.stages[drillStage.stage] ?? 0) - (a.stages[drillStage.stage] ?? 0)
      : b.cycle - a.cycle)
    return issues
  }, [flow, drillStage])

  function openDrill(stage: StageStat | null) {
    setDrillStage(stage)
    setDrillOpen(true)
  }

  const kpis = flow && [
    { label: 'Completed', value: String(flow.completed), sub: `${types.join(' + ')}s`, onClick: () => openDrill(null) },
    { label: 'Cycle time P50', value: `${fmtDays(flow.cycle.p50)}d`, sub: `P85 ${fmtDays(flow.cycle.p85)}d · work started → done` },
    { label: 'Lead time P50', value: `${fmtDays(flow.lead.p50)}d`, sub: `P85 ${fmtDays(flow.lead.p85)}d · created → done` },
    {
      label: 'Flow efficiency',
      value: flow.flow_efficiency == null ? '—' : `${Math.round(flow.flow_efficiency * 100)}%`,
      sub: 'active time / cycle time',
    },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <FlowSidebar
        squad={project}
        squads={PROJECTS}
        types={types}
        monthsUsed={flow?.months_used.length ?? 0}
        onSquadChange={setProject}
        onTypesChange={setTypes}
        onPeriodChange={setPeriod}
      />

      <div className="flex-1 overflow-y-auto">
        {!flow && !loading && !error ? (
          <EmptyState message="Pick a timeframe to analyse your delivery flow" />
        ) : (
          <div className="px-8 py-7 max-w-5xl">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Delivery flow</h2>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Project</span><span className="text-gray-700 dark:text-gray-300">{project}</span></span>
                {periodLabel && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Completed in</span><span className="text-gray-700 dark:text-gray-300">{periodLabel}</span></span>}
                <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Types</span><span className="text-gray-700 dark:text-gray-300">{types.join(', ')}</span></span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500 mb-6"><span className="spinner" /> Loading flow metrics…</div>
            ) : error ? (
              <div className="text-sm text-red-500 mb-6">{error}</div>
            ) : null}

            {flow && !loading && (
              flow.completed === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 mb-8">
                  No {types.join('/')} items completed in the selected timeframe.
                </div>
              ) : (
                <>
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                    {kpis && kpis.map((k) => {
                      const Tag = k.onClick ? 'button' : 'div'
                      return (
                        <Tag
                          key={k.label}
                          onClick={k.onClick}
                          className={`text-left rounded-lg border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-4 py-3 ${k.onClick ? 'hover:border-gray-300 dark:hover:border-slate-500 transition-colors cursor-pointer' : ''}`}
                          title={k.onClick ? 'Show the completed items' : undefined}
                        >
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{k.label}</div>
                          <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">{k.value}</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{k.sub}</div>
                        </Tag>
                      )
                    })}
                  </div>

                  {/* Stage breakdown */}
                  <div className="mb-8">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Where time goes</h3>
                    <StageTable stages={flow.stages} onStageClick={openDrill} />
                  </div>

                  {/* Monthly trend */}
                  {flow.trend.length > 1 && (
                    <div className="mb-8">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Monthly trend</h3>
                      <TrendChart trend={flow.trend} />
                    </div>
                  )}
                </>
              )
            )}

            {/* Aging WIP — open work, independent of the timeframe */}
            {(aging || agingError) && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Aging work in progress</h3>
                {aging
                  ? <AgingTable data={aging} />
                  : <div className="text-sm text-red-500">{agingError}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drill: completed items behind the summary numbers */}
      <DrillDrawer
        visible={drillOpen}
        label={project}
        title={drillStage ? `Time in ${drillStage.label}` : 'Completed items'}
        count={drillRows.length}
        countNoun="items"
        widthClass="w-[720px]"
        onClose={() => setDrillOpen(false)}
      >
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0">
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
              <th className="px-3 py-2 font-medium whitespace-nowrap">Key</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium text-right">SP</th>
              <th className="px-3 py-2 font-medium">Month</th>
              {drillStage && <th className="px-3 py-2 font-medium text-right whitespace-nowrap">{drillStage.label}<span className="font-normal text-[10px] ml-1">days</span></th>}
              <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Cycle<span className="font-normal text-[10px] ml-1">days</span></th>
              <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Lead<span className="font-normal text-[10px] ml-1">days</span></th>
            </tr>
          </thead>
          <tbody>
            {drillRows.map((i) => (
              <tr key={i.key} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <td className="px-3 py-2 whitespace-nowrap">
                  {flow?.jira_url
                    ? <a href={`${flow.jira_url}/browse/${i.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline">{i.key}</a>
                    : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i.key}</span>}
                </td>
                <td className="px-3 py-2"><TagBadge kind="type" value={i.type} iconOnly /></td>
                <td className="px-3 py-2 text-right text-xs text-gray-400 dark:text-gray-500">{i.points ?? ''}</td>
                <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{i.month}</td>
                {drillStage && <td className="px-3 py-2 text-right text-xs font-semibold text-gray-800 dark:text-gray-200">{fmtDays(i.stages[drillStage.stage] ?? 0)}</td>}
                <td className="px-3 py-2 text-right text-xs text-gray-700 dark:text-gray-300">{fmtDays(i.cycle)}</td>
                <td className="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400">{fmtDays(i.lead)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DrillDrawer>
    </div>
  )
}
