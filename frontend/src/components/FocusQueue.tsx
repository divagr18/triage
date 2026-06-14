import type { PullRequest } from '../types'
import { formatFlag, trustColor } from '../utils'

interface Props {
  prs: PullRequest[]
  onSelect: (pr: PullRequest) => void
  limit?: number
  actionLabel?: string
  onAction?: () => void
}

function riskWeight(pr: PullRequest) {
  const flagWeight = pr.flags.length * 8
  const trustWeight = Math.max(0, 70 - pr.contributorTrust.score)
  const reviewWeight = pr.signals.reviewState === 'none' ? 10 : 0
  const codeWeight = pr.signals.coreFilesChanged.length > 0 ? 10 : 0
  return flagWeight + trustWeight + reviewWeight + codeWeight
}

export function FocusQueue({ prs, onSelect, limit = 6, actionLabel, onAction }: Props) {
  const queue = [...prs]
    .filter(
      (pr) =>
        pr.flags.length > 0 ||
        pr.contributorTrust.score < 55 ||
        pr.signals.reviewState === 'none',
    )
    .sort((a, b) => riskWeight(b) - riskWeight(a))
    .slice(0, limit)

  return (
    <section className="surface-soft rounded-lg p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Focus queue</h3>
          <p className="mt-1 text-xs text-zinc-500">Highest-risk cached PRs</p>
        </div>
        {onAction ? (
          <button
            onClick={onAction}
            className="rounded-md border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-200 transition hover:border-sky-400/45 hover:bg-sky-500/15"
          >
            {actionLabel ?? 'Open'}
          </button>
        ) : (
          <div className="text-xs text-zinc-500">{queue.length}</div>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-5 text-center text-xs text-zinc-500">
          No review risks in this cache.
        </div>
      ) : (
        <div className="space-y-2">
          {queue.map((pr) => (
            <button
              key={pr.number}
              onClick={() => onSelect(pr)}
              className="group w-full rounded-md border border-zinc-800/80 bg-black/20 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/30"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="font-mono">#{pr.number}</span>
                    <span>{pr.author.login}</span>
                  </div>
                  <div className="line-clamp-2 text-xs font-medium leading-5 text-zinc-200 group-hover:text-white">
                    {pr.title}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${trustColor(
                    pr.contributorTrust.bucket,
                  )}`}
                >
                  {pr.contributorTrust.score}
                </span>
              </div>

              {pr.flags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {pr.flags.slice(0, 2).map((flag) => (
                    <span
                      key={flag}
                      className="rounded border border-zinc-800 bg-zinc-900/40 px-1.5 py-0.5 text-[10px] text-zinc-400"
                    >
                      {formatFlag(flag)}
                    </span>
                  ))}
                  {pr.flags.length > 2 && (
                    <span className="px-1 text-[10px] text-zinc-600">+{pr.flags.length - 2}</span>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-zinc-500">No human review yet</div>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
