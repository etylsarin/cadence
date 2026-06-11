import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Sparkles } from 'lucide-react'
import HygieneSidebar from './HygieneSidebar'
import FindingsTable from './RuleSection'
import EmptyState from '@/components/EmptyState'
import { api } from '@/lib/api'
import { ALL_SQUADS, useProject } from '@/hooks/useProject'
import type { AuditData, FindingRow } from './types'

export default function Hygiene() {
  const { project, set: setProject } = useProject()

  const [audit, setAudit]     = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [hiddenRules, setHiddenRules] = useState<Set<string>>(new Set())

  const [plan, setPlan]               = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError]     = useState('')
  // Bumped on every project switch so an in-flight plan request can detect
  // it's stale and not render the old project's plan under the new one.
  const planSeq = useRef(0)

  useEffect(() => {
    let cancelled = false
    planSeq.current++
    setLoading(true); setError(''); setAudit(null)
    setPlan(''); setPlanError(''); setPlanLoading(false)
    api<AuditData>(`/hygiene/api/audit?project=${encodeURIComponent(project)}`)
      .then((d) => { if (!cancelled) setAudit(d) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project])

  function toggleRule(id: string, visible: boolean) {
    setHiddenRules((prev) => {
      const next = new Set(prev)
      if (visible) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function draftPlan() {
    const seq = ++planSeq.current
    setPlanLoading(true); setPlanError(''); setPlan('')
    try {
      const d = await api<{ suggestions: string }>('/hygiene/api/suggest', {
        method: 'POST',
        body: JSON.stringify({ project }),
      })
      if (seq === planSeq.current) setPlan(d.suggestions)
    } catch (e) {
      if (seq === planSeq.current) setPlanError((e as Error).message)
    } finally {
      if (seq === planSeq.current) setPlanLoading(false)
    }
  }

  const visibleRules = useMemo(
    () => (audit?.rules ?? []).filter((r) => !hiddenRules.has(r.id)),
    [audit, hiddenRules],
  )

  const findings = useMemo<FindingRow[]>(() => {
    const rows: FindingRow[] = []
    for (const rule of visibleRules) {
      for (const item of rule.items) {
        rows.push({ ...item, rule: rule.label, ruleId: rule.id })
      }
    }
    return rows
  }, [visibleRules])

  const cleanPct = audit && audit.scanned ? Math.round((audit.clean / audit.scanned) * 100) : null

  const kpis = audit && [
    { label: 'Tickets scanned', value: String(audit.scanned), sub: 'work items in the mirror' },
    { label: 'Clean', value: cleanPct == null ? '—' : `${cleanPct}%`, sub: `${audit.clean} tickets pass every rule` },
    { label: 'Violations', value: String(audit.violations), sub: `across ${audit.dirty} tickets` },
    { label: 'Rules failing', value: `${audit.rules.filter((r) => r.count > 0).length}/${audit.rules.length}`, sub: 'see sections below' },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <HygieneSidebar
        squad={project}
        squads={ALL_SQUADS}
        rules={audit?.rules ?? []}
        hiddenRules={hiddenRules}
        onSquadChange={setProject}
        onToggleRule={toggleRule}
      />

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-8 py-7 flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500"><span className="spinner" /> Auditing tickets…</div>
        ) : error ? (
          <div className="px-8 py-7 text-sm text-red-500">{error}</div>
        ) : !audit ? (
          <EmptyState message="Pick a project to audit its ticket hygiene" />
        ) : (
          <div className="px-8 py-7 max-w-5xl">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Ticket hygiene</h2>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Project</span><span className="text-gray-700 dark:text-gray-300">{project}</span></span>
                <span className="text-gray-400 dark:text-gray-500">Bad data in, bad metrics out — these findings skew every other Cadence tool.</span>
              </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
              {kpis && kpis.map((k) => (
                <div key={k.label} className="rounded-lg border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-4 py-3">
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{k.label}</div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">{k.value}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{k.sub}</div>
                </div>
              ))}
            </div>

            {/* AI fix plan */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Fix plan</h3>
                <button
                  className="flex items-center gap-1.5 px-3 py-1 rounded border border-gray-200 dark:border-slate-700 text-xs text-gray-600 dark:text-gray-400 hover:border-gray-900 dark:hover:border-slate-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors disabled:opacity-50"
                  disabled={planLoading || audit.violations === 0}
                  onClick={() => void draftPlan()}
                >
                  {planLoading ? <span className="spinner" /> : <Sparkles size={12} />}
                  {planLoading ? 'Drafting…' : 'Draft with AI'}
                </button>
              </div>
              {planError && <div className="text-sm text-red-500 mb-3">{planError}</div>}
              {plan ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 px-5 py-4"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(plan, { breaks: true }) as string) }}
                />
              ) : !planError && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {audit.violations === 0
                    ? 'Nothing to fix — every ticket passes every rule.'
                    : 'Drafts a prioritised clean-up plan from the findings below — bulk-edit groups, JQL filters and working agreements. Only this step sends data to the AI provider.'}
                </p>
              )}
            </div>

            {/* Unified findings table */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Findings</h3>
                {findings.length > 0 && (
                  <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">{findings.length}</span>
                )}
              </div>
              {findings.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {audit.rules.length > 0 && visibleRules.length === 0
                    ? 'All rules are hidden — enable them in the sidebar.'
                    : 'No findings — every visible rule is clean.'}
                </p>
              ) : (
                <FindingsTable rows={findings} jiraUrl={audit.jira_url} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
