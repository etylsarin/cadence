import { useEffect, useState } from 'react'
import { Database } from 'lucide-react'
import type { SyncStatus, Transformation } from './types'

function timeAgo(isoStr?: string | null): string | null {
  if (!isoStr) return null
  const then = new Date(isoStr.replace('Z', '+00:00'))
  const diffM = Math.floor((Date.now() - then.getTime()) / 60000)
  if (diffM < 1) return 'just now'
  if (diffM < 60) return `${diffM}m ago`
  const diffH = Math.floor(diffM / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}
function formatTs(isoStr?: string | null): string {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function freshnessClass(isoStr?: string | null): string {
  if (!isoStr) return 'text-gray-400'
  const diffH = (Date.now() - new Date(isoStr.replace('Z', '+00:00')).getTime()) / 3600000
  if (diffH < 4) return 'text-green-600'
  if (diffH < 24) return 'text-yellow-600'
  return 'text-red-500'
}

export default function SyncDashboard({ status }: { status: SyncStatus | null }) {
  const [transformations, setTransformations] = useState<Transformation[]>([])
  useEffect(() => {
    fetch('/sync/api/transformations').then((r) => r.json()).then(setTransformations).catch(() => { /* ignore */ })
  }, [])

  if (!status) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 rounded-xl bg-gray-100 dark:bg-slate-700" />
        <div className="h-24 rounded-xl bg-gray-100 dark:bg-slate-700" />
        <div className="h-32 rounded-xl bg-gray-100 dark:bg-slate-700" />
      </div>
    )
  }

  const syncAge = timeAgo(status.last_sync)

  return (
    <div className="space-y-6">
      {/* Sync Status */}
      <section>
        <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Sync Status</h3>
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
          {status.running && (
            <div className="px-5 py-4 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm text-blue-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                Sync in progress…
              </span>
              {status.started_at && <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">started {timeAgo(status.started_at)}</span>}
            </div>
          )}
          <div className="px-5 py-4 flex items-start justify-between">
            <div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Last sync</div>
              <div className="text-[12px] text-gray-900 dark:text-gray-100 font-mono">{formatTs(status.last_sync)}</div>
            </div>
            {syncAge && <span className={`text-xs mt-0.5 ${freshnessClass(status.last_sync)}`}>{syncAge}</span>}
          </div>
          <div className="px-5 py-4 flex items-start justify-between">
            <div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Bronze layer</div>
              <div className="text-[12px] text-gray-900 dark:text-gray-100 font-mono">{status.bronze_count != null ? status.bronze_count.toLocaleString() : '—'} tickets</div>
            </div>
            <Database size={15} className="text-gray-300 dark:text-gray-600 mt-0.5" />
          </div>
          <div className="px-5 py-4 flex items-start justify-between">
            <div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Silver layer</div>
              <div className="text-[12px] text-gray-900 dark:text-gray-100 font-mono">{status.silver_count != null ? status.silver_count.toLocaleString() : '—'} tickets</div>
            </div>
            <Database size={15} className="text-gray-300 dark:text-gray-600 mt-0.5" />
          </div>
        </div>
      </section>

      {/* Gold Layer */}
      <section>
        <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Gold Layer</h3>
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
          {transformations.map((t) => (
            <div key={t.id} className="px-5 py-3.5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{t.name}</div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{t.description}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{t.rows != null ? t.rows.toLocaleString() + ' rows' : '—'}</div>
                {t.updated_at && <div className={`text-[11px] mt-0.5 ${freshnessClass(t.updated_at)}`}>{timeAgo(t.updated_at)}</div>}
              </div>
            </div>
          ))}
          {!transformations.length && <div className="px-5 py-4 text-xs text-gray-400 dark:text-gray-500">No transformations found</div>}
        </div>
      </section>

      {/* Config */}
      <section>
        <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Configuration</h3>
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
          <div className="px-5 py-3.5 flex items-baseline justify-between gap-4"><span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">Projects</span><span className="text-xs text-gray-900 dark:text-gray-100 font-mono text-right">{status.config?.projects ?? '—'}</span></div>
          <div className="px-5 py-3.5 flex items-baseline justify-between gap-4"><span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">Issue types</span><span className="text-xs text-gray-900 dark:text-gray-100 font-mono text-right">{status.config?.issue_types ?? '—'}</span></div>
          <div className="px-5 py-3.5 flex items-baseline justify-between gap-4"><span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">Data from</span><span className="text-xs text-gray-900 dark:text-gray-100 font-mono">{status.config?.start_date ?? '—'}</span></div>
          <div className="px-5 py-3.5 flex items-baseline justify-between gap-4"><span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">Jira URL</span><span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{status.config?.jira_url ?? '—'}</span></div>
        </div>
      </section>
    </div>
  )
}
