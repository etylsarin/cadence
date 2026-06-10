interface Props<T extends string | number> {
  /** Currently-selected value (the group's value). */
  modelValue: T
  /** This radio's value. */
  value: T
  name?: string
  onChange: (value: T) => void
}

/** Styled radio. Vue v-model → controlled `modelValue` + `onChange`. */
export default function AppRadio<T extends string | number>({ modelValue, value, name, onChange }: Props<T>) {
  const active = modelValue === value
  return (
    <label className="flex items-center justify-center cursor-pointer select-none">
      <input
        type="radio"
        name={name}
        checked={active}
        className="sr-only"
        onChange={() => onChange(value)}
      />
      <span
        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-colors shrink-0 ${
          active
            ? 'bg-gray-700 dark:bg-slate-400 border-gray-700 dark:border-slate-400'
            : 'bg-white dark:bg-slate-700 border-gray-400 dark:border-slate-500'
        }`}
      >
        {active && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-slate-900" />}
      </span>
    </label>
  )
}
