import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import VersionSidebar from './VersionSidebar'
import IssueTable from './IssueTable'
import GeneratePanel from './GeneratePanel'
import EmptyState from '@/components/EmptyState'
import { api } from '@/lib/api'
import type { VersionStub, VersionDetail } from './types'

export default function ReleaseNotes() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<VersionStub | null>(null)
  const [detail, setDetail]     = useState<VersionDetail | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const autoSelectId = searchParams.get('version')

  async function onSelect(version: VersionStub | null) {
    if (!version) { setSelected(null); setDetail(null); return }
    if (selected?.id == version.id && detail) return // already loaded
    setSelected(version); setDetail(null); setLoading(true); setError('')
    setSearchParams({ version: String(version.id) }, { replace: true })
    try {
      const d = await api<VersionDetail>(`/release-notes/api/version/${version.id}`)
      setDetail(d)
      setSelected({ ...version, ...d })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Direct URL load with ?version=X — fetch immediately without waiting for the sidebar.
  const didInitialLoad = useRef(false)
  useEffect(() => {
    if (didInitialLoad.current) return
    didInitialLoad.current = true
    const id = searchParams.get('version')
    if (!id) return
    setLoading(true); setError('')
    api<VersionDetail>(`/release-notes/api/version/${id}`)
      .then((d) => {
        setDetail(d)
        setSelected({ id: Number(id), name: d.name, project: d.project, released: d.released, releaseDate: d.releaseDate })
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <VersionSidebar autoSelectId={autoSelectId} onSelect={onSelect} />

      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <EmptyState message="Select a version to view its details" />
        ) : (
          <div className="px-8 py-7 max-w-5xl">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 border border-gray-900 ${selected.released ? 'bg-gray-900' : 'bg-white dark:bg-slate-900'}`}
                  title={selected.released ? 'Released' : 'Unreleased'}
                />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{selected.name}</h2>
                {detail?.jiraUrl && (
                  <a
                    href={`${detail.jiraUrl}/projects/${selected.project}/versions/${selected.id}/tab/release-report-all-issues`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >Jira ↗</a>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pl-5 text-xs">
                {detail ? (
                  <>
                    <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Status</span><span className="text-gray-700 dark:text-gray-300">{detail.released ? 'Released' : 'Unreleased'}</span></span>
                    {detail.startDate && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Start</span><span className="text-gray-700 dark:text-gray-300">{detail.startDate}</span></span>}
                    {detail.releaseDate && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">End</span><span className="text-gray-700 dark:text-gray-300">{detail.releaseDate}</span></span>}
                    <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Id</span><span className="text-gray-700 dark:text-gray-300">{selected.id}</span></span>
                    {detail.driver && <span><span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Driver</span><span className="text-gray-700 dark:text-gray-300">{detail.driver}</span></span>}
                  </>
                ) : loading ? (
                  <span className="text-gray-400 dark:text-gray-500 text-[10px]">Loading…</span>
                ) : null}
              </div>

              {detail && (
                <div className="mt-2 pl-5 text-xs">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">Description</span>
                  <span className="text-gray-700 dark:text-gray-300">{detail.description || '—'}</span>
                </div>
              )}
              {error && <p className="mt-2 text-sm text-red-500 pl-5">{error}</p>}
            </div>

            {/* Issues */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Issues</h3>
                {detail && <span className="text-[10px] bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full font-medium">{detail.issueCount}</span>}
                {loading && <span className="spinner ml-1" />}
              </div>
              {detail && <IssueTable issues={detail.issues} jiraUrl={detail.jiraUrl} />}
            </div>

            {/* Generate */}
            {detail && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Generate Content</h3>
                <GeneratePanel version={{ ...selected, ...detail }} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
