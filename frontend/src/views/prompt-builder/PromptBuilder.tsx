import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import TicketSidebar from './TicketSidebar'
import PromptPanel from './PromptPanel'
import EmptyState from '@/components/EmptyState'
import TagBadge from '@/components/TagBadge'
import { api } from '@/lib/api'
import type { TicketStub, TicketDetail } from './types'

export default function PromptBuilder() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeKey, setActiveKey] = useState<string | null>(searchParams.get('ticket'))
  const [detail, setDetail]       = useState<TicketDetail | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function load(key: string) {
    setDetail(null); setLoading(true); setError('')
    try {
      setDetail(await api<TicketDetail>(`/prompt-builder/api/ticket/${key}`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function onSelect(ticket: TicketStub | null) {
    if (!ticket) { setActiveKey(null); setDetail(null); return }
    if (ticket.key === activeKey && detail) return
    setActiveKey(ticket.key)
    setSearchParams({ ticket: ticket.key }, { replace: true })
    void load(ticket.key)
  }

  const didInitialLoad = useRef(false)
  useEffect(() => {
    if (didInitialLoad.current) return
    didInitialLoad.current = true
    const key = searchParams.get('ticket')
    if (key) void load(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <TicketSidebar activeKey={activeKey} onSelect={onSelect} />

      <div className="flex-1 overflow-y-auto">
        {!activeKey ? (
          <EmptyState message="Select a ticket to build a prompt from it" />
        ) : (
          <div className="px-8 py-7 max-w-4xl">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {activeKey}{detail ? ` — ${detail.summary}` : ''}
                </h2>
                {detail?.jiraUrl && (
                  <a
                    href={`${detail.jiraUrl}/browse/${detail.key}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors shrink-0"
                  >Jira ↗</a>
                )}
              </div>

              {loading && <p className="text-xs text-gray-400">Loading…</p>}
              {error && <p className="text-sm text-red-500">{error}</p>}

              {detail && (
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                  {/* Badge row */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detail.type && <TagBadge kind="type" value={detail.type} />}
                    {detail.priority && detail.priority !== 'None' && <TagBadge kind="priority" value={detail.priority} />}
                    {detail.status && <TagBadge kind="status" value={detail.status} />}
                    {detail.project && <TagBadge kind="project" value={detail.project} />}
                  </div>
                  {/* Date row */}
                  <div className="flex items-center gap-4 text-gray-500 dark:text-gray-400">
                    {detail.created && <span><span className="text-[10px] text-gray-400 mr-1">Created</span>{detail.created}</span>}
                    {detail.updated && <span><span className="text-[10px] text-gray-400 mr-1">Updated</span>{detail.updated}</span>}
                  </div>
                </div>
              )}
            </div>

            {detail && (
              <>
                {/* Context preview */}
                <div className="mb-8 rounded-xl border border-gray-100 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700 bg-white dark:bg-slate-900">
                  {/* Description */}
                  <ContextRow title="Description" empty={!detail.description}>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {detail.description || '—'}
                    </p>
                  </ContextRow>

                  {/* Epic */}
                  {detail.epic && (
                    <ContextRow title="Epic">
                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{detail.epic.key}</span>
                      {detail.epic.summary && <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">{detail.epic.summary}</span>}
                      {detail.epic.description && (
                        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap line-clamp-3">{detail.epic.description}</p>
                      )}
                    </ContextRow>
                  )}

                  {/* Linked issues */}
                  {detail.links.length > 0 && (
                    <ContextRow title={`Linked issues (${detail.links.length})`}>
                      <div className="flex flex-col gap-1">
                        {detail.links.map((l, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{l.relation}</span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{l.key}</span>
                            {l.summary && <span className="text-gray-600 dark:text-gray-400 truncate">{l.summary}</span>}
                            {l.status && <span className="shrink-0 text-[10px] bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">{l.status}</span>}
                          </div>
                        ))}
                      </div>
                    </ContextRow>
                  )}

                  {/* Attachments */}
                  {detail.attachments.length > 0 && (
                    <ContextRow title={`Attachments (${detail.attachments.length})`}>
                      <div className="flex flex-col gap-0.5">
                        {detail.attachments.map((a, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-medium">{a.filename}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">{[a.mimeType, a.created].filter(Boolean).join(' · ')}</span>
                          </div>
                        ))}
                      </div>
                    </ContextRow>
                  )}
                </div>

                {/* Generate */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Generate Prompt</h3>
                  <PromptPanel key={detail.key} detail={detail} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ContextRow({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">{title}</div>
      <div className={empty ? 'text-sm text-gray-300 dark:text-gray-600' : ''}>{empty ? '—' : children}</div>
    </div>
  )
}
