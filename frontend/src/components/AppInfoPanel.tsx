import { useState, type ReactNode } from 'react'

interface Props {
  /** Vue's `#trigger` slot — sits left of the "how it works" toggle. */
  trigger?: ReactNode
  /** Vue's default slot — the collapsible explanatory content. */
  children?: ReactNode
}

/** Collapsible "ℹ how it works" panel. */
export default function AppInfoPanel({ trigger, children }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {trigger}
        <button
          className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
            open
              ? 'border-blue-300 bg-blue-50 text-blue-600'
              : 'border-gray-200 dark:border-slate-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-slate-500'
          }`}
          onClick={() => setOpen((v) => !v)}
        >ℹ how it works</button>
      </div>

      {open && (
        <div className="mt-1 p-4 rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs text-gray-600 dark:text-gray-400 space-y-3 max-w-2xl">
          {children}
        </div>
      )}
    </div>
  )
}
