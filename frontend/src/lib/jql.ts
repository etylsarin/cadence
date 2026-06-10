/**
 * Shared JQL building utilities for Cadence metrics pages (ported from useJql.js).
 *
 * Knows about the team's projects and how to translate a sidebar
 * selection (gran / years / periods) into Jira date clauses.
 */

import { PROJECTS } from '@/constants/squads'

export const KNOWN_TYPES = ['Story', 'Spike', 'Bug', 'Task']

export interface PeriodSelection {
  gran: 'Y' | 'Q' | 'M'
  years: number[]
  periods: string[]
}

const MONTH_MAP: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
const Q_MONTHS: Record<string, number[]> = { Q1: [1, 2, 3], Q2: [4, 5, 6], Q3: [7, 8, 9], Q4: [10, 11, 12] }

/** Returns a sorted list of 'YYYY-MM' strings for the given sidebar period selection. */
export function selectionMonths({ gran, years, periods }: PeriodSelection): string[] {
  const months: string[] = []
  for (const year of years) {
    if (gran === 'Y') {
      for (let m = 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2, '0')}`)
    } else if (gran === 'Q') {
      for (const q of periods) for (const m of Q_MONTHS[q]) months.push(`${year}-${String(m).padStart(2, '0')}`)
    } else if (gran === 'M') {
      for (const p of periods) months.push(`${year}-${String(MONTH_MAP[p]).padStart(2, '0')}`)
    }
  }
  return months.sort()
}

/** Groups a sorted list of 'YYYY-MM' strings into contiguous [start, end] pairs. */
function groupMonthRanges(months: string[]): [string, string][] {
  const ranges: [string, string][] = []
  let start = months[0], prev = months[0]
  for (let i = 1; i < months.length; i++) {
    const [py, pm] = prev.split('-').map(Number)
    const expected = pm === 12 ? `${py + 1}-01` : `${py}-${String(pm + 1).padStart(2, '0')}`
    if (months[i] === expected) { prev = months[i] }
    else { ranges.push([start, prev]); start = months[i]; prev = months[i] }
  }
  ranges.push([start, prev])
  return ranges
}

function nextMonthStart(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/**
 * Converts a sorted list of 'YYYY-MM' strings into a JQL `created` date clause.
 * Consecutive months are collapsed into a single range; gaps produce OR groups.
 */
export function monthsToDateJql(months: string[]): string | null {
  if (!months.length) return null
  const parts = groupMonthRanges(months).map(([s, e]) =>
    `(created >= "${s}-01" AND created < "${nextMonthStart(e)}")`
  )
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`
}

const TERMINAL_STATUSES = '"Closed", "Done", "Rejected", "Delivered"'

/**
 * Converts a sorted list of 'YYYY-MM' strings into a JQL
 * `status CHANGED TO (terminal) DURING (start, end)` clause for throughput.
 *
 * Mirrors Python's first_terminal() semantics: a ticket is counted only in
 * the month of its FIRST terminal transition.
 */
export function terminalChangedDuringJql(months: string[]): string | null {
  if (!months.length) return null
  const parts = groupMonthRanges(months).map(([s, e]) =>
    `status CHANGED TO (${TERMINAL_STATUSES}) DURING ("${s}-01", "${nextMonthStart(e)}")`
  )
  const during    = parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`
  const notBefore = `NOT status CHANGED TO (${TERMINAL_STATUSES}) BEFORE "${months[0]}-01"`
  return `${during} AND ${notBefore}`
}

/**
 * Returns a JQL project clause for a squad.
 * ORG → all configured projects; a specific squad → single project filter.
 */
export function projectClause(squad?: string): string {
  return squad && squad !== 'ORG'
    ? `project = ${squad}`
    : `project in (${PROJECTS.join(', ')})`
}

/** Encodes a JQL string into a full Jira issues URL. */
export function jqlUrl(jiraBase: string, jql: string): string {
  return `${jiraBase}/issues?jql=${encodeURIComponent(jql)}`
}
