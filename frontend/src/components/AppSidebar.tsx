import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Sun, Moon, LogOut, type LucideIcon } from 'lucide-react'
import { useDarkMode } from '@/hooks/useDarkMode'
import { auth, logout } from '@/lib/auth'

interface Props {
  title: string
  icon?: LucideIcon | null
  /** Vue's `#header` slot — extra controls under the title (e.g. SquadSelector). */
  header?: ReactNode
  /** Vue's default slot — the scrollable list/filter area. */
  children?: ReactNode
}

export default function AppSidebar({ title, icon: Icon = null, header, children }: Props) {
  const navigate = useNavigate()
  const { dark, toggle } = useDarkMode()

  return (
    <div className="flex flex-col w-[268px] min-w-[268px] h-screen bg-sidebar border-r border-sidebar-border overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-5 pb-5 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            className="flex items-center text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0"
            onClick={() => navigate('/')}
          >
            <ChevronLeft size={14} />
          </button>
          {Icon && (
            <div className="p-1 rounded-md bg-gray-100 dark:bg-slate-700 shrink-0">
              <Icon size={13} className="text-gray-700 dark:text-gray-300" />
            </div>
          )}
          <h1 className="text-[14px] font-semibold text-gray-900 dark:text-gray-100 leading-tight">{title}</h1>
        </div>
        {header}
      </div>

      {/* List area (scrollable) */}
      <div className="flex-1 overflow-y-auto sidebar-scroll py-2">
        {children}
      </div>

      {/* Dark mode toggle + sign out */}
      <div className="shrink-0 px-4 py-3 border-t border-sidebar-border">
        <button
          onClick={toggle}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
        >
          {dark ? <Sun size={13} /> : <Moon size={13} />}
          <span>{dark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        {auth.required && (
          <button
            onClick={() => void logout()}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </div>
  )
}
