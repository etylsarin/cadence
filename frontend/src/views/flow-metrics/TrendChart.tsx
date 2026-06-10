import type { TrendPoint } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(ym: string, prev?: string): string {
  const [y, m] = ym.split('-')
  const name = MONTHS[parseInt(m, 10) - 1] ?? ym
  // Show the year on the first point and whenever it changes.
  return !prev || prev.slice(0, 4) !== y ? `${name} ${y.slice(2)}` : name
}

const BAR_W = 22
const STEP = 46          // horizontal distance between month centres
const PAD_X = 14
const H = 170
const BAR_BASE = 140     // baseline y for bars and the month axis
const BAR_MAX = 78       // tallest bar height
const LINE_TOP = 14      // y of the highest p85 point
const LINE_BOTTOM = 120

interface Props {
  trend: TrendPoint[]
}

/** Completed items per month (bars) with P50/P85 cycle-time overlay (lines). */
export default function TrendChart({ trend }: Props) {
  const maxCount = Math.max(...trend.map((t) => t.count), 1)
  const maxDays = Math.max(...trend.map((t) => t.cycle_p85 ?? 0), 1)
  const width = trend.length * STEP + PAD_X * 2

  const x = (i: number) => PAD_X + i * STEP + STEP / 2
  const yDays = (d: number) => LINE_BOTTOM - (d / maxDays) * (LINE_BOTTOM - LINE_TOP)

  const linePath = (pick: (t: TrendPoint) => number | null) =>
    trend
      .map((t, i) => {
        const v = pick(t)
        return v == null ? null : `${x(i)},${yDays(v)}`
      })
      .filter(Boolean)
      .join(' ')

  return (
    <div>
      <div className="flex items-center gap-4 mb-2 text-[10px] text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gray-200 dark:bg-slate-700 inline-block" /> Completed items</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-amber-500 inline-block" /> P85 cycle days</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-gray-400 inline-block" /> P50 cycle days</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-2 pt-3">
        <svg width={width} height={H} role="img" aria-label="Monthly completed items and cycle time trend">
          {/* Bars: completed per month */}
          {trend.map((t, i) => {
            const h = (t.count / maxCount) * BAR_MAX
            return (
              <g key={t.month}>
                <rect
                  x={x(i) - BAR_W / 2} y={BAR_BASE - h} width={BAR_W} height={h} rx={2}
                  className="fill-gray-200 dark:fill-slate-700"
                >
                  <title>{`${t.month}: ${t.count} completed`}</title>
                </rect>
                <text x={x(i)} y={BAR_BASE - h - 4} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500 text-[9px]">{t.count}</text>
                <text x={x(i)} y={BAR_BASE + 14} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500 text-[9px]">
                  {monthLabel(t.month, trend[i - 1]?.month)}
                </text>
              </g>
            )
          })}

          {/* Cycle-time lines */}
          <polyline points={linePath((t) => t.cycle_p50)} fill="none" strokeDasharray="3 3" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth={1.5} />
          <polyline points={linePath((t) => t.cycle_p85)} fill="none" className="stroke-amber-500" strokeWidth={1.5} />
          {trend.map((t, i) => t.cycle_p85 == null ? null : (
            <circle key={t.month} cx={x(i)} cy={yDays(t.cycle_p85)} r={2.5} className="fill-amber-500">
              <title>{`${t.month}: P85 ${t.cycle_p85}d · P50 ${t.cycle_p50 ?? '—'}d`}</title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  )
}
