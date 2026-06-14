import { flagColor, formatFlag } from '../utils'
import type { SignalSummary } from '../types'

interface Props {
  summary: SignalSummary
}

export function FlagsList({ summary }: Props) {
  const flags = Object.entries(summary.flagCounts).sort((a, b) => b[1] - a[1])

  return (
    <section className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.24)]">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">Signal flags</h3>
        <p className="mt-1 text-xs text-zinc-500">Deterministic heuristics raised</p>
      </div>
      {flags.length === 0 ? (
        <p className="text-sm text-zinc-500">No flags raised.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {flags.map(([flag, count]) => (
            <span
              key={flag}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${flagColor(flag)}`}
            >
              {formatFlag(flag)}
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">{count}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
