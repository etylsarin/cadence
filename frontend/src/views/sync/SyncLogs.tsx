import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { LogEntry, LogSummary } from './types'

function statusColor(s?: LogSummary): string {
  if (!s?.done) return 'text-yellow-600'
  if (s.errors && s.errors !== '0') return 'text-red-500'
  return 'text-green-600'
}
function statusLabel(s?: LogSummary): string {
  if (!s) return 'Unknown'
  if (!s.done) return 'Incomplete'
  if (s.errors && s.errors !== '0') return `${s.errors} errors`
  return 'OK'
}
function formatTs(name: string): string {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.log$/)
  if (!m) return name
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function formatDuration(s?: number): string | null {
  if (s == null || s < 0) return null
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), sec = s % 60
  if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`
  const h = Math.floor(m / 60), min = m % 60
  return min ? `${h}h ${min}m` : `${h}h`
}

export default function SyncLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<Record<string, string>>({})
  const [loadingLog, setLoadingLog] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    api<LogEntry[]>('/sync/api/logs').then(setLogs).catch((e) => setError((e as Error).message)).finally(() => setLoading(false))
  }, [])

  async function toggle(name: string) {
    if (expanded === name) { setExpanded(null); return }
    setExpanded(name)
    if (logContent[name]) return
    setLoadingLog(name)
    try {
      const text = await fetch(`/sync/api/logs/${encodeURIComponent(name)}`).then((r) => r.text())
      setLogContent((c) => ({ ...c, [name]: text }))
    } catch {
      setLogContent((c) => ({ ...c, [name]: '(failed to load log)' }))
    } finally {
      setLoadingLog(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 rounded-xl bg-gray-100 dark:bg-slate-700" />)}
      </div>
    )
  }
  if (error) return <div className="text-sm text-red-500 px-1">{error}</div>

  return (
    <div className="space-y-1.5">
      {logs.map((log) => {
        const s = log.summary
        const isPipeline = s?.type === 'pipeline'
        const Chevron = expanded === log.name ? ChevronDown : ChevronRight
        return (
          <div key={log.name} className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <button className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors" onClick={() => toggle(log.name)}>
              <Chevron size={14} className="text-gray-400 dark:text-gray-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{formatTs(log.name)}</div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                  {isPipeline ? (
                    <>
                      <span className="text-gray-500 dark:text-gray-400 font-medium">pipeline</span>
                      {s.stages && <span>{s.stages}</span>}
                    </>
                  ) : (
                    <>
                      {s.tickets && <span>{s.tickets} tickets discovered</span>}
                      {s.new && s.new !== '0' && <span>+{s.new} new</span>}
                      {s.updated && s.updated !== '0' && <span>{s.updated} updated</span>}
                      {s.deleted && s.deleted !== '0' && <span>{s.deleted} deleted</span>}
                      {s.time && <span>{s.time}</span>}
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className={`text-[11px] font-medium ${statusColor(s)}`}>{statusLabel(s)}</span>
                {formatDuration(s?.duration_s) && <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatDuration(s.duration_s)}</span>}
              </div>
            </button>

            {expanded === log.name && (
              <div className="border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-5 py-4">
                {loadingLog === log.name
                  ? <div className="text-xs text-gray-400 dark:text-gray-500">Loading…</div>
                  : <pre className="text-[11px] font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">{logContent[log.name]}</pre>}
              </div>
            )}
          </div>
        )
      })}
      {logs.length === 0 && <div className="text-sm text-gray-400 dark:text-gray-500 px-1">No logs found.</div>}
    </div>
  )
}
