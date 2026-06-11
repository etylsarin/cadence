import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, X, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { VersionStub, VersionDetail } from './types'

type SectionKey = 'short' | 'full' | 'biz'

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'short', label: 'Short Description' },
  { key: 'full',  label: 'Full Description' },
  { key: 'biz',   label: 'Business Justification' },
]

interface GenerateResult {
  shortDescription: string
  fullDescription: string
  businessJustification: string
  prompt?: string
}

type SectionMap<T> = Record<SectionKey, T>

export default function GeneratePanel({ version }: { version: VersionStub & Partial<VersionDetail> }) {
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [generated, setGenerated] = useState(false)
  const [texts, setTexts]         = useState<SectionMap<string>>({ short: '', full: '', biz: '' })

  const [regenInstruction, setRegenInstruction] = useState<SectionMap<string>>({ short: '', full: '', biz: '' })
  const [regenLoading, setRegenLoading]         = useState<SectionMap<boolean>>({ short: false, full: false, biz: false })
  const [regenError, setRegenError]             = useState<SectionMap<string>>({ short: '', full: '', biz: '' })
  const [copiedKey, setCopiedKey]               = useState('')

  const [promptOpen, setPromptOpen]       = useState(false)
  const [promptText, setPromptText]       = useState('')
  const [promptLoading, setPromptLoading] = useState(false)

  const versionBody = () => ({ version_id: version.id, project: version.project })

  async function generate() {
    setLoading(true); setError(''); setGenerated(false)
    try {
      const result = await api<GenerateResult>('/release-notes/api/generate', { method: 'POST', body: JSON.stringify(versionBody()) })
      setTexts({ short: result.shortDescription, full: result.fullDescription, biz: result.businessJustification })
      setPromptText(result.prompt ?? '')
      setGenerated(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function regenSection(key: SectionKey) {
    setRegenLoading((s) => ({ ...s, [key]: true }))
    setRegenError((s) => ({ ...s, [key]: '' }))
    try {
      const result = await api<{ text: string }>('/release-notes/api/regenerate-section', {
        method: 'POST',
        body: JSON.stringify({ ...versionBody(), section: key, current: texts[key], instruction: regenInstruction[key] }),
      })
      setTexts((s) => ({ ...s, [key]: result.text }))
      setRegenInstruction((s) => ({ ...s, [key]: '' }))
    } catch (e) {
      setRegenError((s) => ({ ...s, [key]: (e as Error).message }))
    } finally {
      setRegenLoading((s) => ({ ...s, [key]: false }))
    }
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(''), 2000)
  }

  async function openPrompt() {
    setPromptOpen(true)
    if (promptText) return
    setPromptLoading(true)
    try {
      const data = await api<{ prompt: string }>('/release-notes/api/preview-prompt', { method: 'POST', body: JSON.stringify(versionBody()) })
      setPromptText(data.prompt)
    } catch (e) {
      setPromptText(`Error: ${(e as Error).message}`)
    } finally {
      setPromptLoading(false)
    }
  }

  return (
    <div>
      {/* Top controls */}
      <div className="flex items-center gap-2 mb-5">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-slate-400 hover:text-gray-700 dark:hover:text-gray-300 text-xs transition-colors"
          onClick={openPrompt}
        >
          <Eye size={13} />
          View prompt
        </button>
        <button
          className="ml-auto px-4 py-1.5 rounded-lg bg-gray-900 hover:bg-black text-white text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2"
          disabled={loading}
          onClick={generate}
        >
          {loading && <span className="spinner" />}
          {loading ? 'Generating…' : generated ? 'Re-generate all' : 'Generate'}
        </button>
      </div>

      {error && <div className="text-sm text-red-500 mb-4">{error}</div>}

      {/* Result blobs */}
      {generated && (
        <div className="flex flex-col gap-4">
          {SECTIONS.map((s) => (
            <div key={s.key} className="rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{s.label}</h3>
                <button className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors" onClick={() => copy(s.key, texts[s.key])}>
                  {copiedKey === s.key ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <p className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{texts[s.key]}</p>

              <div className="px-4 pb-3 flex items-center gap-2">
                <input
                  value={regenInstruction[s.key]}
                  onChange={(e) => setRegenInstruction((st) => ({ ...st, [s.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') regenSection(s.key) }}
                  type="text"
                  placeholder="Optional instructions…"
                  className="flex-1 text-xs rounded border border-gray-200 dark:border-slate-600 px-2.5 py-1.5 text-gray-700 dark:text-gray-100 dark:bg-slate-800 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:border-gray-400"
                />
                <button
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-gray-200 dark:border-slate-600 text-xs text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-slate-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-40 shrink-0"
                  disabled={regenLoading[s.key]}
                  onClick={() => regenSection(s.key)}
                >
                  <RefreshCw size={12} className={regenLoading[s.key] ? 'animate-spin' : ''} />
                  Re-generate
                </button>
              </div>
              {regenError[s.key] && <div className="px-4 pb-3 text-xs text-red-500">{regenError[s.key]}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Prompt flyout */}
      <PromptFlyout
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        loading={promptLoading}
        text={promptText}
        copyLabel={copiedKey === 'prompt' ? 'Copied!' : 'Copy prompt'}
        onCopy={() => copy('prompt', promptText)}
      />
    </div>
  )
}

function PromptFlyout({ open, onClose, loading, text, copyLabel, onCopy }: {
  open: boolean; onClose: () => void; loading: boolean; text: string; copyLabel: string; onCopy: () => void
}) {
  const [render, setRender] = useState(open)
  const [shown, setShown]   = useState(false)
  useEffect(() => {
    if (open) { setRender(true); const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id) }
    setShown(false); const t = setTimeout(() => setRender(false), 200); return () => clearTimeout(t)
  }, [open])
  if (!render) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className={`absolute inset-0 bg-black/20 transition-opacity duration-150 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <div className={`relative w-[560px] max-w-full h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col transition-transform duration-200 ${shown ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Prompt</h2>
          <button className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? <div className="text-xs text-gray-400 dark:text-gray-500">Loading…</div>
            : <pre className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">{text}</pre>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 dark:border-slate-700 shrink-0">
          <button
            className="w-full px-4 py-2 rounded-lg bg-gray-900 hover:bg-black dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-medium transition-colors"
            onClick={onCopy}
          >{copyLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
