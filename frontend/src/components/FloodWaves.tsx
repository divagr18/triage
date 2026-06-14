import { Waves } from 'lucide-react'
import type { FloodWave, PullRequest } from '../types'
import { formatNumber } from '../utils'

interface Props {
  waves: FloodWave[]
  prs: PullRequest[]
  onSelect: (pr: PullRequest) => void
}

export function FloodWaves({ waves, prs, onSelect }: Props) {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]))
  const shown = waves.slice(0, 5)

  return (
    <section className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.28)]">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">AI flood waves</h3>
          <p className="mt-1 text-xs text-zinc-500">Cache-derived burst patterns</p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-sky-400/20 bg-sky-400/10 text-sky-300">
          <Waves size={15} />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-5 text-center text-xs text-zinc-500">
          No waves above the default threshold.
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((wave) => {
            const best = byNumber.get(wave.bestPr)
            return (
              <div key={wave.id} className="rounded-md border border-zinc-800 bg-black/30 p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-xs font-medium leading-5 text-zinc-200">
                      {wave.label}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {wave.prs.length} PRs / {wave.window}
                    </div>
                  </div>
                  <span className="rounded-md border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-xs font-semibold text-sky-300">
                    {formatNumber(wave.score)}
                  </span>
                </div>

                {best && (
                  <button
                    onClick={() => onSelect(best)}
                    className="mb-2 w-full rounded border border-zinc-800 bg-zinc-900/45 px-2 py-1.5 text-left text-[11px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
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
                        className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition hover:border-zinc-700 hover:text-white"
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
    </section>
  )
}
