import type { CodexPrExplain, PatchTextAlignment, PullRequest } from '../types'
import { ciColor, formatDate, formatFlag, reviewColor, trustColor } from '../utils'

interface Props {
  pr: PullRequest
  selected: boolean
  aiAlignment?: PatchTextAlignment
  aiExplain?: CodexPrExplain
  onClick: () => void
}

export function PrCard({ pr, selected, aiAlignment, aiExplain, onClick }: Props) {
  const trust = pr.contributorTrust
  const signals = pr.signals

  return (
    <button
      onClick={onClick}
      className={`group w-full rounded-lg border p-5 text-left transition sm:p-6 ${
        selected
          ? 'border-zinc-500 bg-zinc-900/70 ring-1 ring-zinc-600'
          : 'border-zinc-800 bg-[#070708] hover:border-zinc-600 hover:bg-[#0b0b0d]'
      }`}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-zinc-400">#{pr.number}</span>
            {pr.isDraft && (
              <span className="rounded-md border border-zinc-600 bg-zinc-800/90 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-300">
                Draft
              </span>
            )}
            <span className="text-sm text-zinc-400">{formatDate(pr.createdAt)}</span>
          </div>
          <h4 className="max-w-4xl break-words text-base font-semibold leading-7 text-zinc-50 group-hover:text-white">
            {pr.title}
          </h4>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-400">
            <span>{pr.author.login}</span>
            <span>{pr.changedFiles} files</span>
            <span className="text-emerald-300">+{pr.additions}</span>
            <span className="text-red-300">-{pr.deletions}</span>
            {signals.ciState !== 'none' && (
              <span className={ciColor(signals.ciState)}>{signals.ciState}</span>
            )}
            {signals.reviewState !== 'none' && (
              <span className={reviewColor(signals.reviewState)}>
                {signals.reviewState.replace(/_/g, ' ')}
              </span>
            )}
            {aiAlignment && (
              <span className="rounded-md border border-sky-400/20 bg-sky-400/[0.08] px-2 py-0.5 text-xs text-sky-200">
                align {Math.round(aiAlignment.alignmentScore * 100)}
              </span>
            )}
            {aiExplain && (
              <span className="rounded-md border border-violet-400/20 bg-violet-400/[0.08] px-2 py-0.5 text-xs text-violet-200">
                Codex
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${trustColor(
              trust.bucket,
            )}`}
          >
            {trust.score}
          </span>
          {pr.flags.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-zinc-400">
              {pr.flags.length} flags
            </span>
          )}
        </div>
      </div>

      {pr.changelets && pr.changelets.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {pr.changelets.slice(0, 4).map((changelet) => (
            <span
              key={changelet}
              className="rounded-md border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-300"
            >
              {changelet}
            </span>
          ))}
          {pr.changelets.length > 4 && (
            <span className="px-1 py-1 text-xs text-zinc-500">+{pr.changelets.length - 4}</span>
          )}
        </div>
      )}

      {pr.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {pr.flags.slice(0, 3).map((flag) => (
            <span
              key={flag}
              className="rounded-md border border-zinc-800 bg-transparent px-2.5 py-1 text-xs text-zinc-400"
            >
              {formatFlag(flag)}
            </span>
          ))}
          {pr.flags.length > 3 && (
            <span className="py-1 text-xs text-zinc-500">+{pr.flags.length - 3} more</span>
          )}
        </div>
      )}
    </button>
  )
}
