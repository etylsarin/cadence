import type { ReactNode } from 'react'
import { MousePointerClick } from 'lucide-react'

interface Props {
  message?: string
  /** Vue's `#icon` slot — overrides the default pointer icon. */
  icon?: ReactNode
}

export default function EmptyState({ message = 'Select an item to get started', icon }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-300 dark:text-gray-600">
      {icon ?? <MousePointerClick size={36} />}
      <p className="text-sm text-gray-400 dark:text-gray-500">{message}</p>
    </div>
  )
}
