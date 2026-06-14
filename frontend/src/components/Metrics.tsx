import { AlertTriangle, GitPullRequest, ShieldAlert, TrendingUp } from 'lucide-react'
import type { TriageCache } from '../types'
import { formatNumber } from '../utils'

interface Props {
  data: TriageCache
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
    neutral: 'text-zinc-200 bg-zinc-900/60 border-zinc-700',
    success: 'text-emerald-400 bg-emerald-500/5 border-emerald-500/15',
    warning: 'text-amber-400 bg-amber-500/5 border-amber-500/15',
    danger: 'text-red-400 bg-red-500/5 border-red-500/15',
  }[tone]

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-4 shadow-[0_14px_45px_rgba(0,0,0,0.22)] transition hover:border-zinc-700">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md border ${toneClass}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-white 2xl:text-3xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}

export function Metrics({ data }: Props) {
  const summary = data.signalSummary
  const avg = summary.averageContributorTrust ?? 0

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
    </section>
  )
}
