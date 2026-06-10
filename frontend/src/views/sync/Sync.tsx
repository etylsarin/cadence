import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import SyncSidebar from './SyncSidebar'
import SyncDashboard from './SyncDashboard'
import SyncLogs from './SyncLogs'
import type { SyncStatus } from './types'

export default function Sync() {
  const [view, setView] = useState('dashboard')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await api<SyncStatus>('/sync/api/status'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  async function startSync(force: boolean) {
    try {
      await api('/sync/api/sync' + (force ? '?force=true' : ''), { method: 'POST' })
      await fetchStatus()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => { void fetchStatus() }, [fetchStatus])

  // Poll every 3s while a sync is running.
  useEffect(() => {
    if (!status?.running) return
    const id = setInterval(() => { void fetchStatus() }, 3000)
    return () => clearInterval(id)
  }, [status?.running, fetchStatus])

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <SyncSidebar view={view} running={status?.running ?? false} onViewChange={setView} onSync={startSync} />

      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-7 max-w-3xl">
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{view === 'dashboard' ? 'Dashboard' : 'Sync Logs'}</h2>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
              {view === 'dashboard' ? 'Jira mirror status and data pipeline overview.' : 'History of bronze sync and pipeline runs.'}
            </p>
          </div>

          {view === 'dashboard' ? <SyncDashboard status={status} /> : <SyncLogs />}
        </div>
      </div>
    </div>
  )
}
