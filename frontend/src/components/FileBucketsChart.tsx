import type { SignalSummary } from '../types'
import { formatNumber } from '../utils'

const BUCKET_META: Record<string, { label: string; color: string }> = {
  code: { label: 'Code', color: 'bg-zinc-300' },
  tests: { label: 'Tests', color: 'bg-emerald-300/80' },
  docs: { label: 'Docs', color: 'bg-sky-300/75' },
  config: { label: 'Config', color: 'bg-amber-300/70' },
  lockfile: { label: 'Lockfile', color: 'bg-zinc-500' },
  generated: { label: 'Generated', color: 'bg-zinc-600' },
  other: { label: 'Other', color: 'bg-zinc-700' },
}

interface Props {
  summary: SignalSummary
}

export function FileBucketsChart({ summary }: Props) {
  const buckets = Object.entries(summary.fileBucketCounts).sort((a, b) => b[1] - a[1])
  const total = buckets.reduce((sum, [, count]) => sum + count, 0)

  return (
    <section className="surface-soft rounded-lg p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">File buckets</h3>
        <p className="mt-1 text-xs text-zinc-500">Touched file categories</p>
      </div>
      {total === 0 ? (
        <p className="text-sm text-zinc-500">No file data available.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex h-2 w-full overflow-hidden rounded bg-zinc-900">
            {buckets.map(([key, count]) => {
              const pct = (count / total) * 100
              const meta = BUCKET_META[key] || { label: key, color: 'bg-zinc-700' }
              return (
                <div
                  key={key}
                  className={meta.color}
                  style={{ width: `${pct}%` }}
                  title={`${meta.label}: ${count}`}
                />
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {buckets.map(([key, count]) => {
              const meta = BUCKET_META[key] || { label: key, color: 'bg-zinc-700' }
              const pct = (count / total) * 100
              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-zinc-800/70 bg-black/15 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-sm ${meta.color}`} />
                    <span className="text-xs text-zinc-300">{meta.label}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {count} <span className="text-zinc-600">({formatNumber(pct)}%)</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
