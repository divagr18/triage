import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, ThumbsUp, X } from 'lucide-react'
import type { PullRequest } from '../types'
import { ciColor, formatFlag, reviewColor, trustColor } from '../utils'
import { PrDiff } from './PrDiff'

interface Props {
  pr: PullRequest | null
  onClose: () => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-zinc-800/80 pb-4 last:border-0 last:pb-0">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {title}
      </h4>
      {children}
    </section>
  )
}

export function PrDetail({ pr, onClose }: Props) {
  const [tab, setTab] = useState<'overview' | 'diff'>('overview')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (pr) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [pr, onClose])

  if (!pr) return null

  const trust = pr.contributorTrust
  const signals = pr.signals

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="animate-fade-in flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-800 bg-zinc-900/35 p-5">
          <div className="min-w-0 pr-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-zinc-500">#{pr.number}</span>
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${trustColor(
                  trust.bucket,
                )}`}
              >
                trust {trust.score}
              </span>
              {pr.isDraft && (
                <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  Draft
                </span>
              )}
            </div>
            <h3 className="text-lg font-semibold leading-snug text-white">{pr.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 text-zinc-500 transition hover:border-zinc-600 hover:text-white"
            aria-label="Close PR detail"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-zinc-800 bg-black/25 px-5">
          {(['overview', 'diff'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`relative px-4 py-3 text-xs font-medium capitalize transition ${
                tab === item ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {item}
              {tab === item && <span className="absolute inset-x-4 bottom-0 h-0.5 bg-white" />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'overview' ? (
            <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="space-y-5">
                <Section title="Author">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-xs font-bold text-white">
                      {pr.author.login.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-zinc-200">{pr.author.login}</div>
                      <div className="text-xs text-zinc-500">
                        {pr.contributor.priorMergedPrs} merged / {pr.contributor.currentOpenPrs} open
                      </div>
                    </div>
                  </div>
                </Section>

                <Section title="Signals">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-zinc-800 bg-black/25 p-2">
                      <div className="text-zinc-500">Changes</div>
                      <div className="mt-0.5 font-mono text-zinc-200">
                        +{pr.additions} / -{pr.deletions}
                      </div>
                    </div>
                    <div className="rounded-md border border-zinc-800 bg-black/25 p-2">
                      <div className="text-zinc-500">Files</div>
                      <div className="mt-0.5 font-mono text-zinc-200">{pr.changedFiles}</div>
                    </div>
                    <div className="rounded-md border border-zinc-800 bg-black/25 p-2">
                      <div className="text-zinc-500">CI state</div>
                      <div className={`mt-0.5 font-medium ${ciColor(signals.ciState)}`}>
                        {signals.ciState}
                      </div>
                    </div>
                    <div className="rounded-md border border-zinc-800 bg-black/25 p-2">
                      <div className="text-zinc-500">Review</div>
                      <div className={`mt-0.5 font-medium ${reviewColor(signals.reviewState)}`}>
                        {signals.reviewState.replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>
                </Section>

                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 py-2.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                >
                  Open on GitHub
                  <ExternalLink size={12} />
                </a>
              </div>

              <div className="space-y-5">
                <Section title="Trust breakdown">
                  <p className="mb-3 text-sm leading-relaxed text-zinc-300">{trust.explanation}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {trust.positives.length > 0 && (
                      <ul className="space-y-1.5">
                        {trust.positives.map((p) => (
                          <li key={p} className="flex items-start gap-2 text-xs text-emerald-400/90">
                            <ThumbsUp size={12} className="mt-0.5 shrink-0" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    )}
                    {trust.risks.length > 0 && (
                      <ul className="space-y-1.5">
                        {trust.risks.map((r) => (
                          <li key={r} className="flex items-start gap-2 text-xs text-red-400/90">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Section>

                {pr.changelets && pr.changelets.length > 0 && (
                  <Section title="Changelets">
                    <div className="flex flex-wrap gap-2">
                      {pr.changelets.map((changelet) => (
                        <span
                          key={changelet}
                          className="rounded-md border border-sky-400/15 bg-sky-400/10 px-2 py-1 text-[11px] text-sky-300"
                        >
                          {changelet}
                        </span>
                      ))}
                    </div>
                  </Section>
                )}

                {pr.flags.length > 0 && (
                  <Section title="Flags">
                    <div className="flex flex-wrap gap-2">
                      {pr.flags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300"
                        >
                          {formatFlag(flag)}
                        </span>
                      ))}
                    </div>
                  </Section>
                )}

                {signals.keywords.length > 0 && (
                  <Section title="Keywords">
                    <div className="flex flex-wrap gap-1.5">
                      {signals.keywords.map((k) => (
                        <span
                          key={k}
                          className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            </div>
          ) : (
            <PrDiff pr={pr} />
          )}
        </div>
      </div>
    </div>
  )
}
