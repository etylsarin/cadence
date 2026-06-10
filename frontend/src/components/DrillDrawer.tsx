import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  visible: boolean
  label?: string
  title?: string
  count?: number
  countNoun?: string
  widthClass?: string
  jqlUrl?: string
  onClose: () => void
  children?: ReactNode
}

/**
 * Right-hand slide-over drill table. Reproduces the Vue version's fade
 * (overlay) + slide (panel) enter/leave via a mount-then-animate pattern so the
 * exit transition plays before unmount.
 */
export default function DrillDrawer({
  visible,
  label = '',
  title = '',
  count = 0,
  countNoun = 'rows',
  widthClass = 'w-[640px]',
  jqlUrl = '',
  onClose,
  children,
}: Props) {
  const [render, setRender] = useState(visible)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (visible) {
      setRender(true)
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setRender(false), 200) // matches duration-200 below
    return () => clearTimeout(t)
  }, [visible])

  if (!render) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/10 transition-opacity duration-150 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <div
        className={`relative max-w-full bg-white dark:bg-slate-900 shadow-xl border-l border-gray-100 dark:border-slate-700 flex flex-col transition-transform duration-200 ${widthClass} ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700 shrink-0 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium mb-0.5">
              Drill Table{label ? ' · ' + label : ''}
            </div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0 mt-0.5">
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{count} {countNoun}</span>
            {jqlUrl && (
              <a
                href={jqlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors border border-gray-200 dark:border-slate-600 rounded px-2 py-0.5"
              >Validate in Jira ↗</a>
            )}
            <button className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
