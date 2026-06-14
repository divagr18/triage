import { useEffect, useState } from 'react'
import { AlertTriangle, Brain, ExternalLink, Loader2, Sparkles, ThumbsUp, X } from 'lucide-react'
import type { AiCache, PrCluster, PullRequest } from '../types'
import type { AiActionRequest } from '../useTriageData'
import { ciColor, formatFlag, reviewColor, trustColor } from '../utils'
import { PrDiff } from './PrDiff'

interface Props {
  pr: PullRequest | null
  prs?: PullRequest[]
  clusters?: PrCluster[]
  ai?: AiCache
  onRunAi?: (body: AiActionRequest) => Promise<unknown> | void
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

function ScoreBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-500">Alignment score</span>
        <span className="font-mono text-sky-200">{percent}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
        <div className="h-full rounded-full bg-sky-400" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function PrDetail({ pr, prs = [], clusters = [], ai, onRunAi, onClose }: Props) {
  const [tab, setTab] = useState<'overview' | 'ai' | 'diff'>('overview')
  const [running, setRunning] = useState<'align' | 'explain' | 'compare' | 'changelets' | 'classify' | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const prNumber = pr.number
  const trust = pr.contributorTrust
  const signals = pr.signals
  const alignment = ai?.alignment[String(prNumber)]
  const explain = ai?.explain[String(prNumber)]
  const llmChangelets = ai?.changelets[String(prNumber)] ?? pr.llmChangelets
  const lowValue = ai?.lowValue[String(prNumber)] ?? pr.ml?.lowValue
  const testRealism = ai?.testRealism[String(prNumber)] ?? pr.ml?.testRealism
  const vision = ai?.vision[String(prNumber)] ?? pr.ml?.vision
  const compareTarget = findCompareTarget(pr, prs, clusters)
  const compare = ai?.compare.find(
    (item) =>
      compareTarget &&
      ((item.leftPr === pr.number && item.rightPr === compareTarget.number) ||
        (item.rightPr === pr.number && item.leftPr === compareTarget.number)),
  )

  async function runAi(action: 'align' | 'explain' | 'changelets' | 'classify') {
    if (!onRunAi) return
    setRunning(action)
    setError(null)
    try {
      await onRunAi({ action, pr: prNumber })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
    }
  }

  async function runCompare() {
    if (!onRunAi || !compareTarget) return
    setRunning('compare')
    setError(null)
    try {
      await onRunAi({ action: 'compare', left: prNumber, right: compareTarget.number })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
    }
  }

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
          {(['overview', 'ai', 'diff'] as const).map((item) => (
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
          ) : tab === 'ai' ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className="space-y-5">
                <Section title="Run analysis">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <button
                      onClick={() => void runAi('align')}
                      disabled={!onRunAi || running !== null}
                      className="flex items-center justify-center gap-2 rounded-md border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-400/45 disabled:opacity-60"
                    >
                      {running === 'align' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Align patch text
                    </button>
                    <button
                      onClick={() => void runAi('explain')}
                      disabled={!onRunAi || running !== null}
                      className="flex items-center justify-center gap-2 rounded-md border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-200 transition hover:border-violet-400/45 disabled:opacity-60"
                    >
                      {running === 'explain' ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                      Explain with Codex
                    </button>
                    <button
                      onClick={() => void runAi('changelets')}
                      disabled={!onRunAi || running !== null}
                      className="flex items-center justify-center gap-2 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:border-cyan-400/45 disabled:opacity-60"
                    >
                      {running === 'changelets' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Changelets
                    </button>
                    <button
                      onClick={() => void runAi('classify')}
                      disabled={!onRunAi || running !== null}
                      className="flex items-center justify-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 transition hover:border-amber-400/45 disabled:opacity-60"
                    >
                      {running === 'classify' ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                      Classify
                    </button>
                    <button
                      onClick={() => void runCompare()}
                      disabled={!onRunAi || running !== null || !compareTarget}
                      className="flex items-center justify-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/45 disabled:opacity-60"
                    >
                      {running === 'compare' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Compare peer
                    </button>
                  </div>
                  {error && (
                    <div className="mt-3 rounded-md border border-red-400/20 bg-red-400/[0.08] px-3 py-2 text-xs text-red-200">
                      {error}
                    </div>
                  )}
                  {!alignment && !explain && !compare && !llmChangelets && !lowValue && !testRealism && !vision && (
                    <p className="mt-3 text-xs leading-5 text-zinc-500">
                      No cached AI analysis for this PR yet.
                    </p>
                  )}
                </Section>

                {alignment && (
                  <Section title="Patch-text alignment">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="rounded-md border border-sky-400/20 bg-sky-400/[0.08] px-2 py-1 text-xs font-medium text-sky-200">
                        {alignment.verdict}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {alignment._cachedAt ? new Date(alignment._cachedAt).toLocaleString() : 'cached'}
                      </span>
                    </div>
                    <ScoreBar value={alignment.alignmentScore} />
                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="mb-1 text-xs font-medium text-zinc-300">Claimed intent</div>
                        <p className="text-sm leading-6 text-zinc-400">{alignment.claimedIntent}</p>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-zinc-300">Actual change</div>
                        <p className="text-sm leading-6 text-zinc-400">{alignment.actualChange}</p>
                      </div>
                    </div>
                  </Section>
                )}

                {llmChangelets && (
                  <Section title="LLM semantic changelets">
                    {llmChangelets.behaviorSummary && (
                      <p className="mb-3 text-sm leading-6 text-zinc-300">{llmChangelets.behaviorSummary}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {llmChangelets.changelets.map((changelet) => (
                        <span
                          key={changelet}
                          className="rounded-md border border-cyan-400/15 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200"
                        >
                          {changelet}
                        </span>
                      ))}
                    </div>
                    {llmChangelets.riskChangelets && llmChangelets.riskChangelets.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {llmChangelets.riskChangelets.map((risk) => (
                          <span
                            key={risk}
                            className="rounded-md border border-amber-400/20 bg-amber-400/[0.08] px-2 py-1 text-[11px] text-amber-200"
                          >
                            {risk}
                          </span>
                        ))}
                      </div>
                    )}
                  </Section>
                )}

                {(lowValue || testRealism || vision) && (
                  <Section title="ML classifiers">
                    <div className="grid gap-3">
                      {lowValue && (
                        <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium text-zinc-300">Low-value classifier</span>
                            <span className="font-mono text-amber-200">
                              {Math.round((lowValue.score ?? 0) * 100)}
                            </span>
                          </div>
                          <p className="text-xs leading-5 text-zinc-500">
                            {lowValue.isLowValue ? lowValue.category?.replace(/_/g, ' ') : 'not low value'}
                          </p>
                          {lowValue.reasons && lowValue.reasons.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-zinc-400">{lowValue.reasons.join('; ')}</p>
                          )}
                        </div>
                      )}
                      {testRealism && (
                        <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium text-zinc-300">Test realism</span>
                            <span className="font-mono text-emerald-200">
                              {Math.round((testRealism.score ?? 0) * 100)}
                            </span>
                          </div>
                          <p className="text-xs leading-5 text-zinc-500">{testRealism.verdict}</p>
                          {testRealism.reasons && testRealism.reasons.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-zinc-400">{testRealism.reasons.join('; ')}</p>
                          )}
                        </div>
                      )}
                      {vision && (
                        <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium text-zinc-300">Vision alignment</span>
                            <span className="font-mono text-fuchsia-200">
                              {Math.round((vision.score ?? 0) * 100)}
                            </span>
                          </div>
                          <p className="text-xs leading-5 text-zinc-500">{vision.verdict}</p>
                          {vision.reasons && vision.reasons.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-zinc-400">{vision.reasons.join('; ')}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {pr.recommendation && (
                  <Section title="Derived recommendation">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 text-xs font-medium text-emerald-200">
                        {pr.recommendation.bucket.replace(/_/g, ' ')}
                      </span>
                      <span className="font-mono text-xs text-zinc-400">
                        {pr.recommendation.score}/100
                      </span>
                      <span className="text-xs text-zinc-500">
                        {Math.round(pr.recommendation.confidence * 100)}% confidence
                      </span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-2 text-xs font-medium text-zinc-300">Reasons</div>
                        <ul className="space-y-1.5">
                          {pr.recommendation.reasons.map((reason) => (
                            <li key={reason} className="text-xs leading-5 text-zinc-400">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-medium text-zinc-300">Risks</div>
                        <ul className="space-y-1.5">
                          {pr.recommendation.risks.map((risk) => (
                            <li key={risk} className="text-xs leading-5 text-zinc-400">
                              {risk}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </Section>
                )}
              </div>

              <div className="space-y-5">
                {compare && (
                  <Section title="Codex compare">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 font-medium text-emerald-200">
                        better: #{compare.betterReviewCandidate}
                      </span>
                      <span className="text-zinc-500">
                        vs #{compare.leftPr === pr.number ? compare.rightPr : compare.leftPr}
                      </span>
                      <span className="text-zinc-500">{Math.round(compare.confidence * 100)}%</span>
                    </div>
                    <p className="text-sm leading-6 text-zinc-300">{compare.canonicalRationale}</p>
                    <p className="mt-3 text-xs leading-5 text-zinc-500">{compare.suggestedAction}</p>
                  </Section>
                )}

                {explain && (
                  <Section title="Codex explanation">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-md border px-2 py-1 text-xs font-medium ${trustColor(explain.riskLevel === 'low' ? 'high' : explain.riskLevel === 'high' ? 'low' : 'medium')}`}>
                        {explain.riskLevel} risk
                      </span>
                      <span className="rounded-md border border-violet-400/20 bg-violet-400/[0.08] px-2 py-1 text-xs font-medium text-violet-200">
                        {explain.recommendedAction.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {Math.round(explain.confidence * 100)}% confidence
                      </span>
                    </div>
                    <p className="mb-4 text-sm leading-6 text-zinc-300">{explain.summary}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {explain.reasons.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-medium text-zinc-300">Reasons</div>
                          <ul className="space-y-2">
                            {explain.reasons.slice(0, 5).map((reason) => (
                              <li key={reason} className="text-xs leading-5 text-zinc-400">
                                {reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {explain.risks.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-medium text-zinc-300">Risks</div>
                          <ul className="space-y-2">
                            {explain.risks.slice(0, 5).map((risk) => (
                              <li key={risk} className="text-xs leading-5 text-zinc-400">
                                {risk}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    {explain.questionsForMaintainer.length > 0 && (
                      <div className="mt-4 rounded-md border border-zinc-800 bg-black/25 p-3">
                        <div className="mb-2 text-xs font-medium text-zinc-300">Maintainer questions</div>
                        <ul className="space-y-1.5">
                          {explain.questionsForMaintainer.map((question) => (
                            <li key={question} className="text-xs leading-5 text-zinc-500">
                              {question}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
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

function findCompareTarget(pr: PullRequest, prs: PullRequest[], clusters: PrCluster[]) {
  const cluster = clusters.find((item) => item.prs.includes(pr.number))
  if (!cluster) return null
  const targetNumber =
    cluster.bestPr !== pr.number ? cluster.bestPr : cluster.prs.find((number) => number !== pr.number)
  if (!targetNumber) return null
  return prs.find((candidate) => candidate.number === targetNumber) ?? null
}
