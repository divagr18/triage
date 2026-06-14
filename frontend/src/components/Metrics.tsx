import { AlertTriangle, GitPullRequest, ShieldAlert, TrendingUp, Waves } from 'lucide-react'
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
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const toneClass = {
    neutral: 'text-zinc-400 bg-zinc-900/40 border-zinc-800',
    success: 'text-emerald-300 bg-transparent border-zinc-800',
    warning: 'text-amber-300 bg-transparent border-zinc-800',
    danger: 'text-red-300 bg-transparent border-zinc-800',
  }[tone]

  return (
    <div className="surface-soft rounded-lg p-4 transition hover:border-zinc-700/80">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</span>
        <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${toneClass}`}>
          <Icon size={14} />
        </div>
      </div>
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
        icon={GitPullRequest}
        tone="neutral"
      />
      <Metric
        label="Avg. Trust"
        value={`${formatNumber(avg)}/100`}
        sub={avg >= 70 ? 'above threshold' : avg >= 40 ? 'review carefully' : 'high risk'}
        icon={TrendingUp}
        tone={avg >= 70 ? 'success' : avg >= 40 ? 'warning' : 'danger'}
      />
      <Metric
        label="Low Value"
        value={String(summary.lowValuePrs)}
        sub={`of ${data.prs.length} flagged`}
        icon={AlertTriangle}
        tone={summary.lowValuePrs > 0 ? 'warning' : 'success'}
      />
      <Metric
        label="Risky Newcomers"
        value={String(summary.riskyNewContributorPrs)}
        sub="new contributor risk"
        icon={ShieldAlert}
        tone={summary.riskyNewContributorPrs > 0 ? 'danger' : 'success'}
      />
      <Metric
        label="AI Flood"
        value={String(floodWaves.length)}
        sub={floodWaves.length ? 'burst patterns' : 'none detected'}
        icon={Waves}
        tone={floodWaves.length > 0 ? 'warning' : 'success'}
      />
    </section>
  )
}
