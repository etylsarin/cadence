import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Send, Loader2, Bot, Sparkles, Search, FileText, List, Ticket, Layers, Activity, Clock, Tag, ChevronDown, ChevronRight } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useProject, ALL_SQUADS } from '@/hooks/useProject'
import AppSidebar from '@/components/AppSidebar'
import SquadSelector from '@/components/SquadSelector'

interface Message {
  role: 'user' | 'assistant'
  content: string
  thinking?: boolean
  toolActivity?: ToolEvent[]
}

interface ToolEvent {
  id: string
  tool: string
  args: Record<string, unknown>
  summary?: string
  isError?: boolean
}

const MONTH_OPTIONS = [
  { value: 3,  label: 'Last 3 months' },
  { value: 6,  label: 'Last 6 months' },
  { value: 12, label: 'Last 12 months' },
  { value: 0,  label: 'All time' },
]

const SUGGESTIONS = [
  'What did we deliver last month?',
  'Which squad has the highest velocity this quarter?',
  'Are there any patterns in our production bugs?',
  'Which tickets have been in progress the longest?',
  'How does cycle time compare across squads?',
  'What are the most common root causes of defects?',
  'How many story points were completed this sprint?',
  'Which assignee has the most open tickets right now?',
]

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { breaks: true }) as string)
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  grep:          Search,
  read:          FileText,
  list_files:    List,
  get_ticket:    Ticket,
  get_epic:      Layers,
  list_sprints:  Activity,
  get_sprint:    Activity,
  status_at:     Clock,
  list_versions: Tag,
}

const TOOL_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  grep:          (a) => `searched for "${a.pattern}" in ${a.glob}`,
  read:          (a) => `read ${a.path}`,
  list_files:    (a) => `listed files matching ${a.glob}`,
  get_ticket:    (a) => `fetched ticket ${a.key}`,
  get_epic:      (a) => `fetched epic ${a.epic_key}`,
  list_sprints:  (a) => `listed sprints for ${a.project}`,
  get_sprint:    (a) => `fetched sprint ${a.sprint_id}`,
  status_at:     (a) => `checked ${a.key} status on ${a.date}`,
  list_versions: (a) => `listed versions for ${a.project}`,
}

function toolLabel(tool: string, args: Record<string, unknown>): string {
  const fn = TOOL_LABELS[tool]
  return fn ? fn(args) : `called ${tool}`
}

function ToolActivity({ events }: { events: ToolEvent[] }) {
  const [expanded, setExpanded] = useState(false)
  if (events.length === 0) return null

  const pending = events[events.length - 1].summary === undefined

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-medium">{events.length} tool call{events.length !== 1 ? 's' : ''}</span>
        {pending && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1 pl-4 border-l-2 border-gray-100 dark:border-slate-700">
          {events.map((ev) => {
            const Icon = TOOL_ICONS[ev.tool] ?? Search
            const label = toolLabel(ev.tool, ev.args)
            const done = ev.summary !== undefined
            return (
              <div key={ev.id} className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${ev.isError ? 'text-red-400' : done ? 'text-indigo-400' : 'text-gray-300'}`} />
                <span className={done ? '' : 'opacity-60'}>
                  {label}
                  {done && ev.summary && (
                    <span className="text-gray-400 dark:text-gray-500"> — {ev.summary.slice(0, 80)}{ev.summary.length > 80 ? '…' : ''}</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Ask() {
  const { project: selectedProject, set: setProject } = useProject(ALL_SQUADS[0], ALL_SQUADS)
  const [selectedMonths, setSelectedMonths] = useState(6)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [totalTickets, setTotalTickets] = useState<number | null>(null)
  const [useAgent, setUseAgent] = useState(true)

  const messagesEnd = useRef<HTMLDivElement>(null)
  const textareaEl  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch('/ask/api/info')
      .then((r) => r.json())
      .then((data) => setTotalTickets(data.total_tickets))
      .catch(() => { /* ignore */ })
  }, [])

  function scrollToBottom() {
    requestAnimationFrame(() => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }))
  }

  function resizeTextarea() {
    const el = textareaEl.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  function patchAssistant(patch: Partial<Message>) {
    setMessages((prev) => {
      const next = prev.slice()
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })
  }

  function appendToolCall(id: string, tool: string, args: Record<string, unknown>) {
    setMessages((prev) => {
      const next = prev.slice()
      const last = next[next.length - 1]
      const activity = [...(last.toolActivity ?? []), { id, tool, args }]
      next[next.length - 1] = { ...last, toolActivity: activity, thinking: false }
      return next
    })
  }

  function resolveToolCall(id: string, summary: string, isError: boolean) {
    setMessages((prev) => {
      const next = prev.slice()
      const last = next[next.length - 1]
      const activity = (last.toolActivity ?? []).slice()
      // Match by call ID so batched same-tool calls resolve independently.
      for (let i = activity.length - 1; i >= 0; i--) {
        if (activity[i].id === id && activity[i].summary === undefined) {
          activity[i] = { ...activity[i], summary, isError }
          break
        }
      }
      next[next.length - 1] = { ...last, toolActivity: activity }
      return next
    })
  }

  async function send(text?: string) {
    const q = (text ?? draft).trim()
    if (!q || isLoading) return

    setDraft('')
    if (textareaEl.current) textareaEl.current.style.height = 'auto'

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: q },
      { role: 'assistant', content: '', thinking: true, toolActivity: [] },
    ])
    setIsLoading(true)
    scrollToBottom()

    const endpoint = useAgent ? '/ask/api/agent-chat' : '/ask/api/chat'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, project: selectedProject, months: selectedMonths }),
      })

      if (!res.ok) {
        patchAssistant({ content: `Error ${res.status}: ${res.statusText}`, thinking: false })
        setIsLoading(false)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') { patchAssistant({ thinking: false }); setIsLoading(false); return }
          try {
            const evt = JSON.parse(raw)
            // Classic endpoint
            if (evt.text)  { content += evt.text; patchAssistant({ content, thinking: false }); scrollToBottom() }
            if (evt.error) { patchAssistant({ content: `Error: ${evt.error}`, thinking: false }) }
            // Agentic endpoint
            if (evt.tool)      { appendToolCall(evt.id ?? evt.tool, evt.tool, evt.args ?? {}); scrollToBottom() }
            if (evt.tool_done) { resolveToolCall(evt.id ?? evt.tool_done, evt.summary ?? '', evt.is_error ?? false) }
            if (evt.usage)     { /* token stats — available in logs */ }
          } catch { /* partial JSON line */ }
        }
      }
      // Clear thinking spinner and any unresolved tool-activity rows when the
      // stream ends without an explicit [DONE] (e.g. server crash mid-loop).
      setMessages((prev) => {
        const next = prev.slice()
        const last = next[next.length - 1]
        if (!last || last.role !== 'assistant') return prev
        const activity = (last.toolActivity ?? []).map((ev) =>
          ev.summary === undefined ? { ...ev, summary: '(interrupted)', isError: true } : ev
        )
        next[next.length - 1] = { ...last, thinking: false, toolActivity: activity }
        return next
      })
    } catch (err) {
      patchAssistant({ content: `Error: ${(err as Error).message}`, thinking: false })
    }

    setIsLoading(false)
  }

  function onKeydown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <AppSidebar
        title="Ask"
        icon={Sparkles}
        header={<SquadSelector value={selectedProject} squads={ALL_SQUADS} onChange={setProject} />}
      >
        {/* Filters */}
        <div className="px-3 pt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Time window</label>
            <select
              value={selectedMonths}
              onChange={(e) => setSelectedMonths(Number(e.target.value))}
              className="w-full text-sm border border-gray-200 dark:border-slate-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Agent toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Agentic mode</span>
            <button
              onClick={() => setUseAgent((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useAgent ? 'bg-indigo-500' : 'bg-gray-200 dark:bg-slate-600'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${useAgent ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {totalTickets !== null && (
            <div className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
              <span><strong className="text-gray-700 dark:text-gray-300 font-medium">{totalTickets.toLocaleString()}</strong> tickets loaded</span>
            </div>
          )}
        </div>

        {/* Suggestions */}
        <div className="px-3 pt-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Suggestions</p>
          <div className="space-y-0.5">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                disabled={isLoading}
                onClick={() => send(q)}
                className="w-full text-left text-xs text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-2 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >{q}</button>
            ))}
          </div>
        </div>
      </AppSidebar>

      {/* Main chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 -mt-8">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />
              </div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">Ask your data</h2>
              <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
                Ask anything about delivery, velocity, defects, or team performance. Pick a suggestion or type your own question.
              </p>
            </div>
          ) : (
            <div className="px-6 py-6 max-w-3xl mx-auto space-y-6">
              {messages.map((msg, i) =>
                msg.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="bg-indigo-600 text-white text-sm px-4 py-2.5 rounded-2xl rounded-br-sm max-w-lg shadow-sm">{msg.content}</div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {msg.toolActivity && msg.toolActivity.length > 0 && (
                        <ToolActivity events={msg.toolActivity} />
                      )}
                      {msg.thinking && !msg.content ? (
                        <div className="flex items-center gap-2 text-gray-400 pt-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span className="text-sm">Thinking…</span>
                        </div>
                      ) : msg.content ? (
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none text-sm text-gray-800 dark:text-gray-200 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                        />
                      ) : null}
                    </div>
                  </div>
                )
              )}
              <div ref={messagesEnd} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-4">
          <div className="max-w-3xl mx-auto flex gap-3 items-end">
            <textarea
              ref={textareaEl}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); resizeTextarea() }}
              onKeyDown={onKeydown}
              disabled={isLoading}
              placeholder="Ask about your Jira data…"
              rows={1}
              className="flex-1 resize-none text-sm border border-gray-300 dark:border-slate-600 rounded-xl px-4 py-2.5 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-50 transition-shadow"
            />
            <button
              onClick={() => send()}
              disabled={!draft.trim() || isLoading}
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white transition-colors"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5 max-w-3xl mx-auto">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  )
}
