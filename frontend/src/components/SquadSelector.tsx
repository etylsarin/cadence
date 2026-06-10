import { PROJ_COLORS } from '@/lib/tags'

interface Props {
  value: string
  squads: string[]
  onChange: (squad: string) => void
}

/** Pill row of squads with the active one filled in its brand color. */
export default function SquadSelector({ value, squads, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1 mt-3 mb-1">
      {squads.map((s) => {
        const active = value === s
        return (
          <button
            key={s}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold transition-all ${
              active ? 'text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
            style={active ? { backgroundColor: PROJ_COLORS[s] ?? '#111' } : undefined}
            onClick={() => onChange(s)}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: active ? 'rgba(255,255,255,0.6)' : (PROJ_COLORS[s] ?? '#999') }}
            />
            {s}
          </button>
        )
      })}
    </div>
  )
}
