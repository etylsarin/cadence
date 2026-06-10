import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { useDarkMode } from '@/hooks/useDarkMode'
import { login } from '@/lib/auth'

const inputCls =
  'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 ' +
  'border border-gray-200 dark:border-slate-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 ' +
  'focus:outline-none focus:border-blue-400 dark:focus:border-blue-500'

/** Standalone sign-in page, rendered instead of the app when a login is
 *  required and this browser has no valid session (see main.tsx). */
export default function Login() {
  useDarkMode()   // applies the persisted dark-mode class

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username, password)
      window.location.reload()   // boot re-runs with the session cookie set
    } catch {
      setError('Wrong username or password')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col items-center justify-center px-5">
      <header className="text-center mb-8">
        <img src="/assets/cadence.png" alt="Cadence logo" className="h-16 w-auto mx-auto mb-4" />
        <h1 className="text-2xl tracking-tight text-gray-950 dark:text-gray-100">
          <span className="font-semibold">Ca</span><span className="font-light">dence</span>
        </h1>
        <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">Sign in to continue</p>
      </header>

      <form onSubmit={(e) => void submit(e)} className="w-full max-w-xs space-y-3">
        <input
          autoFocus
          autoComplete="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputCls}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
        {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                     bg-gray-900 text-white hover:bg-gray-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <LogIn size={14} />{busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
