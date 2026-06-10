import { api } from './api'

/** Login state, populated once at boot (see main.tsx). */
export const auth = { required: false, authenticated: false }

export async function loadAuth(): Promise<void> {
  const a = await api<{ required: boolean; authenticated: boolean }>('/api/auth')
  auth.required = !!a.required
  auth.authenticated = !!a.authenticated
}

/** Throws on wrong credentials; the session cookie is set by the response. */
export async function login(username: string, password: string): Promise<void> {
  await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export async function logout(): Promise<void> {
  await api('/api/logout', { method: 'POST' }).catch(() => { /* cookie may already be gone */ })
  window.location.reload()
}
