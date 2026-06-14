import type { FloodWave, PrCluster, PullRequest } from '../types'
import { formatNumber } from '../utils'

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
  const clusterLimit = pageMode ? 10 : 3
  const shownClusters = clusters.slice(0, clusterLimit)

  return (
    <section className={`${pageMode ? 'surface h-[calc(100vh-9rem)] overflow-y-auto' : 'surface-soft'} rounded-lg p-4`}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">AI flood waves</h3>
          <p className="mt-1 text-xs text-zinc-500">Cache-derived burst patterns</p>
        </div>
        {onAction ? (
          <button
            onClick={onAction}
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 transition hover:border-amber-400/45 hover:bg-amber-500/15"
          >
            {actionLabel ?? 'Open'}
          </button>
        ) : (
          <div className="text-xs text-zinc-500">{shown.length}</div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-5 text-center text-xs text-zinc-500">
          No waves above the default threshold.
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

                <div className="mb-2 flex flex-wrap gap-1.5">
                  {wave.prs.slice(0, 8).map((number) => {
                    const pr = byNumber.get(number)
                    return (
                      <button
                        key={number}
                        onClick={() => pr && onSelect(pr)}
                        className="rounded border border-zinc-800 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition hover:border-zinc-700 hover:text-white"
                      >
                        #{number}
                      </button>
                    )
                  })}
                  {wave.prs.length > 8 && <span className="px-1 text-[10px] text-zinc-600">+{wave.prs.length - 8}</span>}
                </div>

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

      {shownClusters.length > 0 && (
        <div className="mt-5 border-t border-zinc-800/70 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Duplicate clusters
              </h4>
              <p className="mt-1 text-xs text-zinc-600">Repeated intent near the flood surface</p>
            </div>
            <span className="text-xs text-zinc-600">{clusters.length}</span>
          </div>
          <div className={pageMode ? 'grid gap-2 xl:grid-cols-2' : 'space-y-2'}>
            {shownClusters.map((cluster) => {
              const best = byNumber.get(cluster.bestPr)
              return (
                <button
                  key={cluster.id}
                  onClick={() => best && onSelect(best)}
                  className="w-full rounded-md border border-sky-500/15 bg-sky-500/[0.035] p-3 text-left transition hover:border-sky-400/35 hover:bg-sky-500/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-xs font-medium text-zinc-200">
                        {cluster.label}
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-zinc-500">
                        Best: #{cluster.bestPr} {cluster.bestTitle}
                      </div>
                    </div>
                    <span className="rounded border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
                      {cluster.size}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
