import { Brain, Loader2, Sparkles } from 'lucide-react'
import type { CodexRecommendationBatch, PullRequest } from '../types'

interface Props {
  batch?: CodexRecommendationBatch
  prs: PullRequest[]
  onSelect: (pr: PullRequest) => void
  limit?: number
  compact?: boolean
  onRun?: () => void
  running?: boolean
  error?: string | null
}

const actionTone: Record<string, string> = {
  review_first: 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200',
  needs_info: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-200',
  risky_but_maybe_valuable: 'border-orange-400/25 bg-orange-400/[0.08] text-orange-200',
  safe_close_duplicate: 'border-sky-400/25 bg-sky-400/[0.08] text-sky-200',
  probably_junk: 'border-red-400/25 bg-red-400/[0.08] text-red-200',
}

export function AiReviewPlan({
  batch,
  prs,
  onSelect,
  limit = 4,
  compact = false,
  onRun,
  running = false,
  error = null,
}: Props) {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]))
  const items = batch?.recommendations.slice(0, limit) ?? []

  if (!batch || items.length === 0) {
    return (
      <section className="surface-soft rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-500">
            <Brain size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Codex review plan</h3>
            <p className="mt-1 text-xs text-zinc-500">No cached Codex recommendations for this repo yet.</p>
          </div>
          {onRun && (
            <button
              onClick={onRun}
              disabled={running}
              className="ml-auto rounded-md border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-200 transition hover:border-sky-400/45 disabled:opacity-60"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : 'Run Codex'}
            </button>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded-md border border-red-400/20 bg-red-400/[0.08] px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="surface-soft rounded-lg p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky-300">
            <Sparkles size={14} />
            Codex review plan
          </div>
          {!compact && <p className="max-w-4xl text-sm leading-6 text-zinc-400">{batch.summary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-md border border-zinc-800 bg-black/25 px-2.5 py-1 text-xs text-zinc-500">
            {batch._provider?.replace('_', ' ') ?? 'codex'} cached
          </div>
          {onRun && (
            <button
              onClick={onRun}
              disabled={running}
              className="rounded-md border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-200 transition hover:border-sky-400/45 disabled:opacity-60"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : 'Refresh'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mb-3 rounded-md border border-red-400/20 bg-red-400/[0.08] px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-2 xl:grid-cols-2">
        {items.map((item) => {
          const pr = byNumber.get(item.pr)
          const tone = actionTone[item.action] ?? 'border-zinc-700 bg-zinc-900/40 text-zinc-300'
          return (
            <button
              key={`${item.pr}-${item.priority}`}
              onClick={() => pr && onSelect(pr)}
              disabled={!pr}
              className="group rounded-md border border-zinc-800 bg-black/20 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/35 disabled:cursor-default disabled:opacity-60"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span className="font-mono">#{item.pr}</span>
                    <span>priority {item.priority}</span>
                    <span>{Math.round(item.confidence * 100)}%</span>
                  </div>
                  <div className="line-clamp-2 text-sm font-medium leading-5 text-zinc-100 group-hover:text-white">
                    {pr?.title ?? 'PR not found in cache'}
                  </div>
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${tone}`}>
                  {item.action.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-zinc-500">{item.reason}</p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
