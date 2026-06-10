import { useState } from 'react'
import { RefreshCw, LayoutDashboard, ScrollText, TriangleAlert } from 'lucide-react'
import AppSidebar from '@/components/AppSidebar'
import AppCheckbox from '@/components/AppCheckbox'

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'logs',      label: 'Sync Logs', icon: ScrollText },
]

interface Props {
  view: string
  running?: boolean
  onViewChange: (view: string) => void
  onSync: (force: boolean) => void
}

export default function SyncSidebar({ view, running = false, onViewChange, onSync }: Props) {
  const [force, setForce] = useState(false)

  return (
    <AppSidebar title="Sync Now" icon={RefreshCw}>
      {/* Sync controls */}
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2">
        <button
          className={`w-full flex items-center justify-center gap-2 rounded px-3 py-2 text-xs font-medium transition-colors ${running ? 'bg-gray-100 dark:bg-slate-700 text-gray-400 cursor-not-allowed' : 'bg-gray-900 text-white hover:bg-gray-700'}`}
          disabled={running}
          onClick={() => { if (!running) onSync(force) }}
        >
          <RefreshCw size={13} className={running ? 'animate-spin' : ''} />
          {running ? 'Syncing…' : 'Sync Now'}
        </button>

        <div className={`flex items-center gap-2 px-1 ${running ? 'opacity-40 pointer-events-none' : ''}`}>
          <AppCheckbox checked={force} onChange={setForce}>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Force re-download all</span>
          </AppCheckbox>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2.5">
          <TriangleAlert size={13} className="text-amber-500 dark:text-amber-500 shrink-0 mt-px" />
          <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
            {force
              ? 'Force mode re-downloads every ticket, expect this to take a couple of hours.'
              : 'Sync fetches only changed tickets from Jira, usually takes a couple of minutes.'}
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="px-3 pt-3 pb-3">
        <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5 px-1">View</div>
        <div className="flex flex-col gap-0.5">
          {VIEWS.map((v) => {
            const Icon = v.icon
            return (
              <button
                key={v.id}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors flex items-center gap-2 ${view === v.id ? 'bg-sidebar-active text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-sidebar-hover'}`}
                onClick={() => onViewChange(v.id)}
              >
                <Icon size={13} />
                {v.label}
              </button>
            )
          })}
        </div>
      </div>
    </AppSidebar>
  )
}
