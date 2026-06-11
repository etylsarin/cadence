import { useState } from 'react'
import { api } from '@/lib/api'
import type { TicketDetail } from './types'

export default function PromptPanel({ detail }: { detail: TicketDetail }) {
  const [instruction, setInstruction] = useState('')
  const [prompt, setPrompt]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)

  async function generate() {
    setLoading(true); setError('')
    try {
      const data = await api<{ prompt: string }>('/prompt-builder/api/prompt', {
        method: 'POST',
        body: JSON.stringify({ key: detail.key, instruction }),
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

  function save() {
    const blob = new Blob([prompt], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${detail.key}.prompt.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
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
            <div className="flex items-center gap-3">
              <button
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                onClick={save}
              >Save .md</button>
              <button
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                onClick={copy}
              >{copied ? 'Copied!' : 'Copy'}</button>
            </div>
          </div>
          <pre className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">{prompt}</pre>
        </div>
      )}
    </div>
  )
}
