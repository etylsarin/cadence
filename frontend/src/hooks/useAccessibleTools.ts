import { useEffect, useState } from 'react'
import type { Tool } from '@/types'

/**
 * Navigable tool ids from the backend, fetched once and cached at module
 * scope. Mirrors the Vue router's `fetchEnabledToolIds` guard — a tool removed
 * from the config.env registry redirects home.
 */

// Short TTL instead of a permanent cache: the accessible set grows after the
// first sync completes (all tools unlock), so it must be re-checked.
const TTL_MS = 30_000

let cache: string[] | null = null
let cachedAt = 0
let inflight: Promise<string[]> | null = null

function fetchIds(): Promise<string[]> {
  if (cache && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetch('/api/accessible-tools')
      .then((r) => r.json())
      .then((tools: Tool[]) => { cache = tools.map((t) => t.id); return cache })
      .catch(() => cache ?? [])
      .finally(() => { cachedAt = Date.now(); inflight = null })
  }
  return inflight
}

export function useAccessibleTools(): { ids: string[]; loaded: boolean } {
  const [ids, setIds] = useState<string[] | null>(cache)
  useEffect(() => {
    let mounted = true
    fetchIds().then((v) => { if (mounted) setIds(v) })
    return () => { mounted = false }
  }, [])
  return { ids: ids ?? [], loaded: ids !== null }
}
