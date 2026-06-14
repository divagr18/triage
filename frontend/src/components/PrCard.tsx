import { CheckCircle2, FileCode2, GitCommitHorizontal, MessageSquareWarning, ShieldAlert } from 'lucide-react'
import type { PullRequest } from '../types'
import { ciColor, formatDate, formatFlag, reviewColor, trustColor } from '../utils'

interface Props {
  pr: PullRequest
  selected: boolean
  onClick: () => void
}

export function PrCard({ pr, selected, onClick }: Props) {
  const trust = pr.contributorTrust
  const signals = pr.signals

  return (
    <button
      onClick={onClick}
      className={`group relative min-h-[158px] w-full rounded-lg border bg-black/30 p-4 text-left transition ${
        selected
          ? 'border-white/30 bg-white/[0.05] ring-1 ring-white/20'
          : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/45'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-500">#{pr.number}</span>
            {pr.isDraft && (
              <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Draft
              </span>
            )}
            <span className="text-xs text-zinc-500">{formatDate(pr.createdAt)}</span>
          </div>
          <h4 className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-zinc-100 group-hover:text-white">
            {pr.title}
          </h4>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <GitCommitHorizontal size={12} />
              {pr.author.login}
            </span>
            <span className="flex items-center gap-1">
              <FileCode2 size={12} />
              {pr.changedFiles} files
            </span>
            <span className="flex items-center gap-1 text-emerald-400/80">+{pr.additions}</span>
            <span className="flex items-center gap-1 text-red-400/80">-{pr.deletions}</span>
            {signals.ciState !== 'none' && (
              <span className={`flex items-center gap-1 ${ciColor(signals.ciState)}`}>
                <CheckCircle2 size={12} />
                {signals.ciState}
              </span>
            )}
            {signals.reviewState !== 'none' && (
              <span className={`flex items-center gap-1 ${reviewColor(signals.reviewState)}`}>
                <MessageSquareWarning size={12} />
                {signals.reviewState.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${trustColor(
              trust.bucket,
            )}`}
          >
            {trust.score}
          </span>
          {pr.flags.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
              <ShieldAlert size={12} />
              {pr.flags.length}
            </span>
          )}
        </div>
      </div>

      {pr.changelets && pr.changelets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pr.changelets.slice(0, 3).map((changelet) => (
            <span
              key={changelet}
              className="rounded border border-sky-400/15 bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-300/90"
            >
              {changelet}
            </span>
          ))}
          {pr.changelets.length > 3 && (
            <span className="px-1 text-[10px] text-zinc-600">+{pr.changelets.length - 3}</span>
          )}
        </div>
      )}

      {pr.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pr.flags.slice(0, 3).map((flag) => (
            <span
              key={flag}
              className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400"
            >
              {formatFlag(flag)}
            </span>
          ))}
          {pr.flags.length > 3 && (
            <span className="text-[10px] text-zinc-600">+{pr.flags.length - 3} more</span>
          )}
        </div>
      )}
    </button>
  )
}
