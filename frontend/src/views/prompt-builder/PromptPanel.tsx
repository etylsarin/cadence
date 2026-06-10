import { useState } from 'react'
import AppCheckbox from '@/components/AppCheckbox'
import { api } from '@/lib/api'
import type { TicketDetail } from './types'

type IncludeKey = 'description' | 'epic' | 'links' | 'attachments'

export default function PromptPanel({ detail }: { detail: TicketDetail }) {
  const [include, setInclude] = useState<Record<IncludeKey, boolean>>({
    description: true, epic: true, links: true, attachments: true,
  })
  const [instruction, setInstruction] = useState('')
  const [prompt, setPrompt]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)

  const toggles: { key: IncludeKey; label: string; available: boolean }[] = [
    { key: 'description', label: 'Description',   available: !!detail.description },
    { key: 'epic',        label: 'Epic',          available: !!detail.epic },
    { key: 'links',       label: `Linked issues (${detail.links.length})`, available: detail.links.length > 0 },
    { key: 'attachments', label: `Attachments (${detail.attachments.length})`, available: detail.attachments.length > 0 },
  ]

  async function generate() {
    setLoading(true); setError('')
    try {
      const data = await api<{ prompt: string }>('/prompt-builder/api/prompt', {
        method: 'POST',
        body: JSON.stringify({ key: detail.key, include, instruction }),
      })
      setPrompt(data.prompt)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      {/* Include toggles */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs text-gray-500 dark:text-gray-400">
        {toggles.map((t) => (
          <span key={t.key} className={t.available ? '' : 'opacity-40 pointer-events-none'}>
            <AppCheckbox
              checked={include[t.key] && t.available}
              onChange={(checked) => setInclude((s) => ({ ...s, [t.key]: checked }))}
            >
              {t.label}
            </AppCheckbox>
          </span>
        ))}
      </div>

      {/* Optional instruction + generate */}
      <div className="flex items-start gap-2 mb-4">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
          placeholder="Optional instructions for Claude (e.g. focus on tests, propose a design first)…"
          className="flex-1 text-xs rounded border border-gray-200 dark:border-slate-600 px-2.5 py-1.5 text-gray-700 dark:text-gray-100 dark:bg-slate-800 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:border-gray-400 resize-y"
        />
        <button
          className="px-4 py-1.5 rounded-lg bg-gray-900 hover:bg-black text-white text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2 shrink-0"
          disabled={loading}
          onClick={generate}
        >
          {loading && <span className="spinner" />}
          {loading ? 'Generating…' : prompt ? 'Re-generate' : 'Generate prompt'}
        </button>
      </div>

      {error && <div className="text-sm text-red-500 mb-4">{error}</div>}

      {/* Result */}
      {prompt && (
        <div className="rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Prompt</h3>
            <button className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors" onClick={copy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">{prompt}</pre>
        </div>
      )}
    </div>
  )
}
