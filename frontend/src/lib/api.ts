/**
 * Shared API fetch wrapper (ported from the Vue app's useApi composable).
 */

/** HTML-escape a value for safe interpolation into markup (e.g. PPT export). */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Simple fetch wrapper. Throws with a human-readable message on error.
 */
export async function api<T = unknown>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  })
  if (!res.ok) {
    let detail = ''
    try { detail = ((await res.json()) as { detail?: string }).detail ?? '' } catch { /* not JSON */ }
    throw new Error(`HTTP ${res.status}${detail ? ': ' + detail : ''}`)
  }
  return res.json() as Promise<T>
}
