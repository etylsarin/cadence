import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Sun, Moon, Heart, RefreshCw, AlertTriangle, LogOut } from 'lucide-react'
import { useDarkMode } from '@/hooks/useDarkMode'
import { auth, logout } from '@/lib/auth'
import CadenceLogo from '@/components/CadenceLogo'
import { TOOL_META } from '@/constants/tools'
import type { Tool, SyncState } from '@/types'

const version = typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : ''

interface ToolsResponse {
  tools: Tool[]
  sync: SyncState
}

function formatLastSync(iso: string | null): string {
  if (!iso) return 'unknown'
  const t = new Date(iso)
  if (isNaN(t.getTime())) return iso
  const mins = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000))
  const rel =
    mins < 1 ? 'just now'
    : mins < 60 ? `${mins} min ago`
    : mins < 60 * 48 ? `${Math.round(mins / 60)} h ago`
    : `${Math.round(mins / 1440)} days ago`
  return `${rel} (${t.toLocaleString()})`
}

export default function HomePage() {
  const navigate = useNavigate()
  const { dark, toggle } = useDarkMode()
  const [tools, setTools] = useState<Tool[]>([])
  const [sync, setSync] = useState<SyncState | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/tools')
      .then((r) => r.json())
      .then((data: ToolsResponse) => {
        if (mounted) {
          setTools(data.tools)
          setSync(data.sync)
        }
      })
      .catch(() => { /* leave empty */ })
    return () => { mounted = false }
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col items-center justify-center px-5 pt-16 pb-12 relative">
      {auth.required && (
        <button
          onClick={() => void logout()}
          className="fixed top-4 right-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700 transition-colors"
        >
          <LogOut size={13} />
          <span>Sign out</span>
        </button>
      )}
      <div className="fixed bottom-0 right-0 left-0 flex items-center justify-between px-4 py-3 text-xs text-gray-400 dark:text-gray-600 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
        <button
          onClick={toggle}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700 transition-colors"
        >
          {dark ? <Sun size={13} /> : <Moon size={13} />}
          <span>{dark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <div className="flex items-center gap-1.5">
          <Heart size={11} className="shrink-0" />
          <span>v{version}</span>
        </div>
      </div>

      <header className="text-center mb-12">
        <CadenceLogo className="h-20 w-auto mx-auto mb-4 text-gray-950 dark:text-white" />
        <h1 className="text-3xl tracking-tight text-gray-950 dark:text-gray-100">
          <span className="font-semibold">Ca</span><span className="font-light">dence</span>
        </h1>
        <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">JIRA productivity tools</p>
      </header>

      {sync && (
        sync.synced ? (
          <div className="flex items-center gap-2 w-full max-w-4xl mb-6 px-4 py-2.5 rounded-lg text-sm
                          bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700
                          text-gray-500 dark:text-gray-400">
            <RefreshCw size={14} className="shrink-0" />
            <span>Data last synced {formatLastSync(sync.last_sync)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 w-full max-w-4xl mb-6 px-4 py-2.5 rounded-lg text-sm
                          bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800
                          text-amber-800 dark:text-amber-300">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              No synced data yet — open <b>Sync Now</b> and run a sync.
              The other tools are disabled until the first sync completes.
            </span>
          </div>
        )
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full max-w-4xl mb-14">
        {tools.map((tool) => {
          const Icon = TOOL_META[tool.id]?.icon
          const disabled = sync !== null && !sync.synced && tool.id !== 'sync'
          return (
            <button
              key={tool.id}
              disabled={disabled}
              className={
                disabled
                  ? 'group bg-white dark:bg-slate-900 rounded-xl px-6 py-6 text-left border border-gray-200 dark:border-slate-700 opacity-40 cursor-not-allowed'
                  : `group bg-white dark:bg-slate-900 rounded-xl px-6 py-6 text-left border border-gray-200 dark:border-slate-700
                     hover:border-gray-900 dark:hover:border-slate-400 hover:shadow-sm transition-all duration-150 cursor-pointer`
              }
              onClick={() => { if (!disabled) navigate('/' + tool.id) }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-2 rounded-lg bg-gray-100 dark:bg-slate-700">
                  {Icon && <Icon size={20} className="text-gray-900 dark:text-gray-100" />}
                </div>
                <ArrowRight size={16} className="text-gray-300 dark:text-gray-600 group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors mt-1" />
              </div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{tool.name}</h3>
              </div>
              <p className="text-sm text-gray-400 dark:text-gray-500 leading-relaxed">{tool.desc}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
