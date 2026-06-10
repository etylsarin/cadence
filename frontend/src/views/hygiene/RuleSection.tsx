import TagBadge from '@/components/TagBadge'
import type { RuleResult } from './types'

function fmt(n: number | null | undefined): string {
  if (n == null) return ''
  return Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(1)
}

interface Props {
  rule: RuleResult
  jiraUrl?: string
}

/** One hygiene rule: heading with count, explanation, offending-ticket table. */
export default function RuleSection({ rule, jiraUrl = '' }: Props) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{rule.label}</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${rule.count ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'}`}>
        {rule.count ? `${rule.count} ${rule.count === 1 ? 'ticket' : 'tickets'}` : 'clean'}
        </span>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{rule.description}</p>

      {rule.count > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-800 text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Key</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">SP</th>
                <th className="px-3 py-2 font-medium w-full">Summary</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Finding</th>
              </tr>
            </thead>
            <tbody>
              {rule.items.map((i) => (
                <tr key={i.key} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {jiraUrl
                      ? <a href={`${jiraUrl}/browse/${i.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline">{i.key}</a>
                      : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i.key}</span>}
                  </td>
                  <td className="px-3 py-2"><TagBadge kind="type" value={i.type} iconOnly /></td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmt(i.points)}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{i.summary}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><TagBadge kind="status" value={i.status} /></td>
                  <td className="px-3 py-2 text-xs text-amber-700 dark:text-amber-500 whitespace-nowrap">{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
