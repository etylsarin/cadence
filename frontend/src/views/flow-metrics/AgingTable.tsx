import TagBadge from '@/components/TagBadge'
import type { AgingData } from './types'

function fmtDays(d: number | null): string {
  return d == null ? '—' : d.toFixed(1)
}

interface Props {
  data: AgingData
}

/** Open started work, oldest-in-status first. Items whose age exceeds the
 *  historic P85 lead time (created → done, the like-for-like comparator for
 *  age) are flagged — they are already slower than 85% of finished work. */
export default function AgingTable({ data }: Props) {
  const { items, lead_p85: p85, jira_url: jiraUrl } = data

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="text-gray-900 dark:text-gray-100 font-semibold">{items.length} items in progress</span>
        {p85 != null && (
          <span>· historic P85 lead time <span className="font-medium text-gray-700 dark:text-gray-300">{p85.toFixed(1)}d</span></span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
              <th className="px-3 py-2 font-medium whitespace-nowrap">Key</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium text-right">SP</th>
              <th className="px-3 py-2 font-medium w-full">Summary</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right whitespace-nowrap">In status<span className="font-normal text-[10px] ml-1">days</span></th>
              <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Age<span className="font-normal text-[10px] ml-1">days</span></th>
            </tr>
          </thead>
          <tbody>
            {!items.length ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 text-xs">No started work in progress — nothing is aging.</td></tr>
            ) : (
              items.map((i) => {
                const overdue = p85 != null && i.age_days != null && i.age_days > p85
                return (
                  <tr key={i.key} className="border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {jiraUrl
                        ? <a href={`${jiraUrl}/browse/${i.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-900 dark:text-gray-100 hover:underline">{i.key}</a>
                        : <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i.key}</span>}
                    </td>
                    <td className="px-3 py-2"><TagBadge kind="type" value={i.type} iconOnly /></td>
                    <td className="px-3 py-2 text-right text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{i.points ?? ''}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{i.summary}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><TagBadge kind="status" value={i.status} /></td>
                    <td className="px-3 py-2 text-right text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDays(i.in_status_days)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className={`text-xs ${overdue ? 'font-semibold text-amber-600 dark:text-amber-500' : 'text-gray-700 dark:text-gray-300'}`}>{fmtDays(i.age_days)}</span>
                      {overdue && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" title={`Older than the historic P85 lead time (${p85?.toFixed(1)}d, created → done)`}>&gt; P85</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
