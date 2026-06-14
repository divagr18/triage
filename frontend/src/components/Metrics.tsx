import type { FloodWave } from '../types'
import type { TriageCache } from '../types'
import { formatNumber } from '../utils'

interface Props {
  data: TriageCache
  floodWaves: FloodWave[]
}

function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const accentClass = {
    neutral: 'border-l-zinc-600',
    success: 'border-l-emerald-300/70',
    warning: 'border-l-amber-300/70',
    danger: 'border-l-red-300/70',
  }[tone]

  return (
    <div className={`surface-soft rounded-lg border-l-2 p-4 transition hover:border-zinc-700/80 ${accentClass}`}>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold tracking-tight text-zinc-50">{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}

export function Metrics({ data, floodWaves }: Props) {
  const summary = data.signalSummary
  const avg = summary.averageContributorTrust ?? 0

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric
        label="Pull Requests"
        value={String(data.prs.length)}
        sub={`scanned ${data.state}`}
        tone="neutral"
      />
      <Metric
        label="Avg. Trust"
        value={`${formatNumber(avg)}/100`}
        sub={avg >= 70 ? 'above threshold' : avg >= 40 ? 'review carefully' : 'high risk'}
        tone={avg >= 70 ? 'success' : avg >= 40 ? 'warning' : 'danger'}
      />
      <Metric
        label="Low Value"
        value={String(summary.lowValuePrs)}
        sub={`of ${data.prs.length} flagged`}
        tone={summary.lowValuePrs > 0 ? 'warning' : 'success'}
      />
      <Metric
        label="Risky Newcomers"
        value={String(summary.riskyNewContributorPrs)}
        sub="new contributor risk"
        tone={summary.riskyNewContributorPrs > 0 ? 'danger' : 'success'}
      />
      <Metric
        label="AI Flood"
        value={String(floodWaves.length)}
        sub={floodWaves.length ? 'burst patterns' : 'none detected'}
        tone={floodWaves.length > 0 ? 'warning' : 'success'}
      />
    </section>
  )
}
