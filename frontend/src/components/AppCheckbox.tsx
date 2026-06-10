import type { ChangeEvent, ReactNode } from 'react'

interface Props {
  checked: boolean
  onChange: (checked: boolean, e: ChangeEvent<HTMLInputElement>) => void
  children?: ReactNode
}

/** Styled checkbox. Vue v-model → controlled `checked` + `onChange`. */
export default function AppCheckbox({ checked, onChange, children }: Props) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        className="sr-only"
        onChange={(e) => onChange(e.target.checked, e)}
      />
      <span
        className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors shrink-0 ${
          checked
            ? 'bg-gray-700 dark:bg-slate-400 border-gray-700 dark:border-slate-400'
            : 'bg-white dark:bg-slate-700 border-gray-400 dark:border-slate-500'
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white dark:text-slate-900" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children}
    </label>
  )
}
