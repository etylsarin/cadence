import { useMemo } from 'react'
import { getTagProps, type TagKind } from '@/lib/tags'

const TYPE_ICONS: Record<string, string> = {
  bug:   '/assets/bug.png',
  story: '/assets/story.png',
  task:  '/assets/task.png',
  spike: '/assets/spike.png',
}
const PRIORITY_ICONS: Record<string, string> = {
  critical: '/assets/critical.png',
  high:     '/assets/high.png',
  medium:   '/assets/medium.png',
  low:      '/assets/low.png',
}

interface Props {
  kind: TagKind
  value?: string
  iconOnly?: boolean
}

export default function TagBadge({ kind, value = '', iconOnly = false }: Props) {
  const tag = useMemo(() => getTagProps(kind, value), [kind, value])

  const iconSrc = useMemo(() => {
    const vl = (value ?? '').toLowerCase()
    if (kind === 'type') {
      for (const [kw, src] of Object.entries(TYPE_ICONS)) if (vl.includes(kw)) return src
    }
    if (kind === 'priority') {
      for (const [kw, src] of Object.entries(PRIORITY_ICONS)) if (vl.includes(kw)) return src
    }
    return null
  }, [kind, value])

  // PNG icon (type / priority)
  if (iconSrc) {
    return (
      <span title={tag.label} className="inline-flex items-center gap-1.5">
        <img src={iconSrc} alt={tag.label} width={14} height={14} className="shrink-0" />
        {!iconOnly && <span className="text-[11px] text-gray-600 dark:text-gray-400">{tag.label}</span>}
      </span>
    )
  }

  // Colored project badge
  if (kind === 'project') {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold text-white leading-none"
        style={{ backgroundColor: tag.projColor }}
      >{tag.label}</span>
    )
  }

  // Tailwind-classed badge (status, scope, outcome, …)
  if (tag.cls) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium leading-none ${tag.cls}`}>
        {tag.label}
      </span>
    )
  }

  // Fallback plain text
  return <span className="text-[11px] text-gray-400 dark:text-gray-500">{tag.label}</span>
}
