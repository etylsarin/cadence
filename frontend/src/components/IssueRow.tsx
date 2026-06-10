import TagBadge from './TagBadge'
import type { Issue } from '@/types'

interface Props {
  issue: Issue
  jiraUrl?: string
  showPriority?: boolean
  showScope?: boolean
  showOutcome?: boolean
  showPoints?: boolean
}

/** A Jira issue table row. Render inside a <tbody>. */
export default function IssueRow({
  issue,
  jiraUrl = '',
  showPriority = true,
  showScope = false,
  showOutcome = false,
  showPoints = false,
}: Props) {
  return (
    <tr>
      <td className="px-3 py-2 whitespace-nowrap">
        {jiraUrl ? (
          <a href={`${jiraUrl}/browse/${issue.key}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-blue-600 hover:underline">{issue.key}</a>
        ) : (
          <span className="text-xs font-mono text-slate-500">{issue.key}</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <TagBadge kind="type" value={issue.type} />
      </td>
      {showPriority && (
        <td className="px-3 py-2 text-center">
          <TagBadge kind="priority" value={issue.priority} />
        </td>
      )}
      {showScope && (
        <td className="px-3 py-2 text-center">
          <TagBadge kind="scope" value={issue.injected ? 'injected' : 'planned'} />
        </td>
      )}
      <td className="px-3 py-2 text-sm text-slate-700 dark:text-gray-300 max-w-xs">{issue.summary}</td>
      <td className="px-3 py-2">
        <TagBadge kind="status" value={issue.status} />
      </td>
      {showOutcome && (
        <td className="px-3 py-2 text-center">
          <TagBadge kind="outcome" value={issue.approved ? 'approved' : issue.delivered ? 'delivered' : 'not-done'} />
        </td>
      )}
      {showPoints && (
        <td className="px-3 py-2 text-right text-xs text-slate-500">{issue.points || ''}</td>
      )}
    </tr>
  )
}
