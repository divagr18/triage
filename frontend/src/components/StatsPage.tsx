import type { FloodWave, PrCluster, PullRequest, TrendItem, TrendReport, TriageCache } from '../types'
import { formatFlag, formatNumber, trustColor } from '../utils'

interface Props {
  data: TriageCache
  clusters: PrCluster[]
  trends: TrendReport
  floodWaves: FloodWave[]
  onSelect: (pr: PullRequest) => void
}

const TREND_TONES = [
  'bg-sky-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-fuchsia-400',
  'bg-rose-400',
]

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone: string
}) {
  return (
    <div className={`surface-soft rounded-lg border-t-2 p-4 ${tone}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{sub}</div>
    </div>
  )
}

function TrendPanel({ title, items }: { title: string; items: TrendItem[] }) {
  const max = Math.max(1, ...items.map((item) => item.count))

  return (
    <section className="surface-soft rounded-lg p-4">
      <h3 className="mb-4 text-sm font-semibold text-white">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No trend data available.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => {
            const pct = Math.max(5, (item.count / max) * 100)
            return (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-zinc-300">{item.label}</span>
                  <span className="shrink-0 text-zinc-500">{item.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className={`h-full rounded-full ${TREND_TONES[index % TREND_TONES.length]}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ClusterPanel({
  clusters,
  byNumber,
  onSelect,
}: {
  clusters: PrCluster[]
  byNumber: Map<number, PullRequest>
  onSelect: (pr: PullRequest) => void
}) {
  return (
    <section className="surface rounded-lg p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">Duplicate clusters</h3>
        <p className="mt-1 text-xs text-zinc-500">Repeated semantic intent from changelets, files, and titles.</p>
      </div>
      {clusters.length === 0 ? (
        <p className="text-sm text-zinc-500">No duplicate clusters above threshold.</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {clusters.slice(0, 12).map((cluster) => {
            const best = byNumber.get(cluster.bestPr)
            return (
              <button
                key={cluster.id}
                onClick={() => best && onSelect(best)}
                className="rounded-md border border-sky-500/15 bg-sky-500/[0.035] p-3 text-left transition hover:border-sky-400/35 hover:bg-sky-500/[0.06]"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-1 text-sm font-medium text-zinc-100">{cluster.label}</div>
                    <div className="mt-1 line-clamp-1 text-xs text-zinc-500">
                      Canonical: #{cluster.bestPr} {cluster.bestTitle}
                    </div>
                  </div>
                  <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-200">
                    {cluster.size}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cluster.reasons.slice(0, 2).map((reason) => (
                    <span
                      key={reason}
                      className="rounded border border-zinc-800 bg-black/25 px-2 py-0.5 text-[11px] text-zinc-400"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ReportPanel({ data, floodWaves }: { data: TriageCache; floodWaves: FloodWave[] }) {
  const flags = Object.entries(data.signalSummary.flagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <section className="surface-soft rounded-lg p-4">
      <h3 className="mb-4 text-sm font-semibold text-white">Report snapshot</h3>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between gap-4 border-b border-zinc-900 pb-2">
          <span className="text-zinc-500">Repository</span>
          <span className="truncate text-zinc-200">{data.repo}</span>
        </div>
        <div className="flex justify-between gap-4 border-b border-zinc-900 pb-2">
          <span className="text-zinc-500">Window</span>
          <span className="text-zinc-200">{data.since || 'latest available'}</span>
        </div>
        <div className="flex justify-between gap-4 border-b border-zinc-900 pb-2">
          <span className="text-zinc-500">Flood waves</span>
          <span className="text-amber-200">{floodWaves.length}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-zinc-500">Top flag</span>
          <span className="truncate text-zinc-200">
            {flags[0] ? `${formatFlag(flags[0][0])} (${flags[0][1]})` : 'none'}
          </span>
        </div>
      </div>
      {flags.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {flags.slice(1).map(([flag, count]) => (
            <span
              key={flag}
              className="rounded border border-amber-500/20 bg-amber-500/[0.08] px-2 py-0.5 text-[11px] text-amber-100/80"
            >
              {formatFlag(flag)} {count}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

export function StatsPage({ data, clusters, trends, floodWaves, onSelect }: Props) {
  const byNumber = new Map(data.prs.map((pr) => [pr.number, pr]))
  const avgTrust = data.signalSummary.averageContributorTrust ?? 0
  const trusted = data.prs.filter((pr) => pr.contributorTrust.bucket === 'high').length
  const lowTrust = data.signalSummary.lowTrustPrs

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Stats</h2>
        <p className="mt-2 text-sm text-zinc-400">Report summary, cluster shape, and scan trends.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="PRs" value={String(data.prs.length)} sub={data.state} tone="border-t-sky-400" />
        <StatCard
          label="Avg Trust"
          value={`${formatNumber(avgTrust)}`}
          sub="out of 100"
          tone={avgTrust >= 70 ? 'border-t-emerald-400' : avgTrust >= 45 ? 'border-t-amber-400' : 'border-t-rose-400'}
        />
        <StatCard label="Trusted" value={String(trusted)} sub="high bucket" tone="border-t-emerald-400" />
        <StatCard label="Low Trust" value={String(lowTrust)} sub="needs care" tone="border-t-rose-400" />
        <StatCard label="Clusters" value={String(clusters.length)} sub="duplicates" tone="border-t-sky-400" />
        <StatCard label="Flood" value={String(floodWaves.length)} sub="waves" tone="border-t-amber-400" />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.6fr)]">
        <ClusterPanel clusters={clusters} byNumber={byNumber} onSelect={onSelect} />
        <ReportPanel data={data} floodWaves={floodWaves} />
      </div>

      <section className="grid gap-5 xl:grid-cols-3">
        <TrendPanel title="PRs by day" items={trends.dailyPrs} />
        <TrendPanel title="Top changelets" items={trends.topChangelets} />
        <TrendPanel title="Touched files" items={trends.topFiles} />
        <TrendPanel title="Contributor trust" items={trends.trustBuckets} />
        <TrendPanel title="Review state" items={trends.reviewStates} />
        <section className="surface-soft rounded-lg p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Trust distribution</h3>
          <div className="grid grid-cols-2 gap-2">
            {trends.trustBuckets.map((bucket) => (
              <div key={bucket.label} className="rounded-md border border-zinc-800 bg-black/20 p-3">
                <div className="text-xs capitalize text-zinc-500">{bucket.label}</div>
                <div className={`mt-2 inline-flex rounded-md border px-2 py-1 text-sm font-semibold ${trustColor(bucket.label.replace(' ', '_'))}`}>
                  {bucket.count}
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  )
}
