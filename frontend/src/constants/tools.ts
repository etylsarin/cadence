import type { LucideIcon } from 'lucide-react'

/**
 * Per-tool presentation (icon + display name). Icons are React components so
 * they can't live in config.env — this is the one per-tool detail kept on the
 * frontend. The homepage card's name + description still come from the backend
 * (/api/tools); the `name` here is the fallback used by route stubs and titles.
 *
 * Order matches the TOOLS[] registry in config.env.
 */
export const TOOL_META: Record<string, { name: string; icon: LucideIcon }> = {
}
