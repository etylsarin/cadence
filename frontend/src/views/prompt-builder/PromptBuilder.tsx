import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import TicketSidebar from './TicketSidebar'
import PromptPanel from './PromptPanel'
import EmptyState from '@/components/EmptyState'
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
    if (ticket.key === activeKey && detail) return // already loaded
    setActiveKey(ticket.key)
    setSearchParams({ ticket: ticket.key }, { replace: true })
    void load(ticket.key)
  }

  // Direct URL load with ?ticket=KEY — fetch immediately without waiting for the sidebar.
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
          <div className="px-8 py-7 max-w-5xl">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {activeKey}{detail ? ` — ${detail.summary}` : ''}
                </h2>
                {detail?.jiraUrl && (
                  <a
                    href={`${detail.jiraUrl}/browse/${detail.key}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >Jira ↗</a>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                {detail ? (
                  <>
                    <Meta label="Type" value={detail.type} />
                    <Meta label="Status" value={detail.status} />
                    <Meta label="Priority" value={detail.priority} />
                    <Meta label="Created" value={detail.created} />
                    <Meta label="Updated" value={detail.updated} />
                  </>
                ) : loading ? (
                  <span className="text-gray-400 dark:text-gray-500 text-[10px]">Loading…</span>
                ) : null}
              </div>
              {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            </div>

            {detail && (
              <>
                {/* Context preview */}
                <div className="mb-8 flex flex-col gap-4">
                  <Section title="Description">
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {detail.description || '—'}
                    </p>
                  </Section>

                  <Section title="Epic">
                    {detail.epic ? (
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        <span className="font-medium">{detail.epic.key}</span>
                        {detail.epic.summary && <span className="ml-1.5">{detail.epic.summary}</span>}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500">No epic</p>
                    )}
                  </Section>

                  <Section title={`Linked issues (${detail.links.length})`}>
                    {detail.links.length ? (
                      <ul className="text-sm text-gray-700 dark:text-gray-300 flex flex-col gap-1">
                        {detail.links.map((l, i) => (
                          <li key={i}>
                            <span className="text-gray-400 dark:text-gray-500">{l.relation}</span>
                            <span className="font-medium ml-1.5">{l.key}</span>
                            {l.summary && <span className="ml-1.5">{l.summary}</span>}
                            {l.status && <span className="ml-1.5 text-[10px] bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">{l.status}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500">No linked issues</p>
                    )}
                  </Section>

                  <Section title={`Attachments (${detail.attachments.length})`}>
                    {detail.attachments.length ? (
                      <ul className="text-sm text-gray-700 dark:text-gray-300 flex flex-col gap-1">
                        {detail.attachments.map((a, i) => (
                          <li key={i}>
                            {a.filename}
                            <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500">{[a.mimeType, a.created].filter(Boolean).join(' · ')}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500">No attachments</p>
                    )}
                  </Section>
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

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <span>
      <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">{label}</span>
      <span className="text-gray-700 dark:text-gray-300">{value}</span>
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}
