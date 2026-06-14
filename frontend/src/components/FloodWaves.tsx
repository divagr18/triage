import type { FloodWave, PrCluster, PullRequest } from '../types'
import { formatDate, formatNumber, trustColor } from '../utils'

interface Props {
  waves: FloodWave[]
  prs: PullRequest[]
  clusters?: PrCluster[]
  onSelect: (pr: PullRequest) => void
  limit?: number
  pageMode?: boolean
  actionLabel?: string
  onAction?: () => void
}

export function FloodWaves({
  waves,
  prs,
  clusters = [],
  onSelect,
  limit = 5,
  pageMode = false,
  actionLabel,
  onAction,
}: Props) {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]))
  const shown = waves.slice(0, limit)
  const clusterLimit = pageMode ? limit : Math.min(limit, 3)
  const shownClusters = clusters.slice(0, clusterLimit)
  const hasClusters = shownClusters.length > 0

  return (
    <section className={`${pageMode ? 'surface h-[calc(100vh-9rem)] overflow-y-auto' : 'surface-soft'} rounded-lg p-4`}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">AI flood clusters</h3>
          <p className="mt-1 text-xs text-zinc-500">Repeated intent grouped before PR inspection</p>
        </div>
        {onAction ? (
          <button
            onClick={onAction}
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 transition hover:border-amber-400/45 hover:bg-amber-500/15"
          >
            {actionLabel ?? 'Open'}
          </button>
        ) : (
          <div className="text-xs text-zinc-500">{hasClusters ? shownClusters.length : shown.length}</div>
        )}
      </div>

      {hasClusters ? (
        <div className={pageMode ? 'grid gap-3 xl:grid-cols-2 2xl:grid-cols-3' : 'space-y-2'}>
          {shownClusters.map((cluster) => {
            const members = cluster.prs
              .map((number) => byNumber.get(number))
              .filter((pr): pr is PullRequest => Boolean(pr))
            const lead = pickClusterLead(members)
            const displayedMembers = orderClusterMembers(members, lead?.pr.number)
            const evidence = topClusterWave(cluster, waves)
            return (
              <div
                key={cluster.id}
                className="w-full rounded-md border border-amber-500/15 bg-amber-500/[0.035] p-3"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">
                      {cluster.label}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {cluster.size} similar PRs
                      {evidence ? ` / ${evidence.window}` : ''}
                    </div>
                  </div>
                  <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200">
                    {evidence ? formatNumber(evidence.score) : cluster.size}
                  </span>
                </div>

                <div className="mb-3 space-y-1.5">
                  {displayedMembers.map((pr) => {
                    const isLead = lead?.pr.number === pr.number
                    return (
                      <button
                        key={pr.number}
                        onClick={() => onSelect(pr)}
                        className={`w-full rounded-md border px-2.5 py-2 text-left transition ${
                          isLead
                            ? 'border-sky-400/35 bg-sky-500/[0.09]'
                            : 'border-zinc-800/80 bg-black/20 hover:border-zinc-700 hover:bg-zinc-900/35'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="font-mono text-zinc-400">#{pr.number}</span>
                              {isLead && (
                                <span className="rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-sky-100">
                                  {lead.label}
                                </span>
                              )}
                              <span className="text-zinc-500">{formatDate(pr.createdAt)}</span>
                              <span className="text-zinc-600">{pr.author.login}</span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-zinc-200">
                              {pr.title}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold ${trustColor(
                              pr.contributorTrust.bucket,
                            )}`}
                          >
                            {pr.contributorTrust.score}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="space-y-1.5">
                  {cluster.reasons.slice(0, 3).map((reason) => (
                    <div key={reason} className="text-[11px] leading-4 text-zinc-500">
                      {reason}
                    </div>
                  ))}
                  {evidence?.reasons.slice(0, 2).map((reason) => (
                    <div key={reason} className="text-[11px] leading-4 text-amber-100/55">
                      {reason}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-5 text-center text-xs text-zinc-500">
          No flood clusters above the default threshold.
        </div>
      ) : (
        <div className={pageMode ? 'grid gap-3 xl:grid-cols-2' : 'space-y-2'}>
          {shown.map((wave) => {
            const best = byNumber.get(wave.bestPr)
            return (
              <div key={wave.id} className="rounded-md border border-amber-500/15 bg-amber-500/[0.035] p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-xs font-medium leading-5 text-zinc-200">
                      {wave.label}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {wave.prs.length} PRs / {wave.window}
                    </div>
                  </div>
                  <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200">
                    {formatNumber(wave.score)}
                  </span>
                </div>

                {best && (
                  <button
                    onClick={() => onSelect(best)}
                    className="mb-2 w-full rounded border border-sky-500/20 bg-sky-500/[0.06] px-2 py-1.5 text-left text-[11px] text-sky-100/80 transition hover:border-sky-400/40 hover:text-sky-50"
                  >
                    Review first: #{best.number} {best.title}
                  </button>
                )}

                <div className="space-y-1">
                  {wave.reasons.slice(0, 3).map((reason) => (
                    <div key={reason} className="text-[11px] leading-4 text-zinc-500">
                      {reason}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function topClusterWave(cluster: PrCluster, waves: FloodWave[]) {
  const clusterSet = new Set(cluster.prs)
  return [...waves]
    .map((wave) => ({
      wave,
      overlap: wave.prs.filter((number) => clusterSet.has(number)).length,
    }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.wave.score - a.wave.score)[0]?.wave
}

function pickClusterLead(members: PullRequest[]) {
  if (members.length === 0) return null
  const byCreated = [...members].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
  const earliest = byCreated[0]
  const next = byCreated[1]
  if (!next || hoursBetween(earliest.createdAt, next.createdAt) >= 2) {
    return { pr: earliest, label: 'original' }
  }
  const trusted = [...members].sort(
    (a, b) =>
      b.contributorTrust.score - a.contributorTrust.score ||
      +new Date(a.createdAt) - +new Date(b.createdAt),
  )[0]
  return { pr: trusted, label: 'highest trust' }
}

function hoursBetween(left: string, right: string) {
  return Math.abs(+new Date(right) - +new Date(left)) / 36e5
}

function orderClusterMembers(members: PullRequest[], leadNumber?: number) {
  return [...members].sort((a, b) => {
    if (a.number === leadNumber) return -1
    if (b.number === leadNumber) return 1
    return +new Date(a.createdAt) - +new Date(b.createdAt)
  })
}
