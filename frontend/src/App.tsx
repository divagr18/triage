import { useMemo, useState } from 'react'
import { Database, Loader2 } from 'lucide-react'
import { Header } from './components/Header'
import { Metrics } from './components/Metrics'
import { FileBucketsChart } from './components/FileBucketsChart'
import { FlagsList } from './components/FlagsList'
import { FocusQueue } from './components/FocusQueue'
import { FloodWaves } from './components/FloodWaves'
import { AiReviewPlan } from './components/AiReviewPlan'
import { PrList } from './components/PrList'
import { PrDetail } from './components/PrDetail'
import { Sidebar, type PageKey } from './components/Sidebar'
import { StatsPage } from './components/StatsPage'
import { SettingsPage } from './components/SettingsPage'
import { useRepos, useRepoData } from './useTriageData'
import type { FloodWave, PrCluster, PullRequest, SignalSummary, TriageCache } from './types'
import { buildAiFloodWaves, buildFloodClusters, buildPrClusters, buildTrendReport } from './utils'

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/70 text-zinc-500">
        <Database size={22} />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-white">No repository selected</h2>
      <p className="max-w-sm text-sm leading-6 text-zinc-500">
        Choose a cached repository from the menu to visualize triage signals.
      </p>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-24">
      <Loader2 className="h-8 w-8 animate-spin text-zinc-300" />
      <p className="mt-4 text-sm text-zinc-500">Loading triage data...</p>
    </div>
  )
}

function ScanHeader({ data }: { data: TriageCache }) {
  const scannedAt = data.scannedAt ? new Date(data.scannedAt).toLocaleString() : 'unknown'
  const source = data.source?.replace(/_/g, ' ') || 'cache'

  return (
    <section className="surface rounded-lg p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="rounded-md border border-zinc-800/70 bg-black/20 px-2 py-0.5">{data.state}</span>
            <span className="rounded-md border border-zinc-800/70 bg-black/20 px-2 py-0.5">
              schema v{data.schemaVersion}
            </span>
            <span className="rounded-md border border-zinc-800/70 bg-black/20 px-2 py-0.5">
              {source}
            </span>
          </div>
          <h2 className="truncate text-2xl font-semibold tracking-tight text-white">
            {data.repo}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">Scanned {scannedAt}</p>
        </div>

        <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-3 lg:min-w-[460px]">
          <div className="rounded-md border border-zinc-800/70 bg-black/[0.18] p-3">
            <div className="mb-1 font-medium text-zinc-300">Cache</div>
            <div className="truncate">{data.limit} PR limit</div>
          </div>
          <div className="rounded-md border border-zinc-800/70 bg-black/[0.18] p-3">
            <div className="mb-1 font-medium text-zinc-300">Window</div>
            <div className="truncate">{data.since || 'latest available'}</div>
          </div>
          <div className="rounded-md border border-zinc-800/70 bg-black/[0.18] p-3">
            <div className="mb-1 font-medium text-zinc-300">Signals</div>
            <div className="truncate">{Object.keys(data.signalSummary.flagCounts).length} flag types</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function CommandStrip({ data }: { data: TriageCache }) {
  const command = useMemo(() => {
    const since = data.since ? ` --since ${data.since}` : ''
    return `python triage.py scan ${data.repo} --state ${data.state} --limit ${data.limit}${since}`
  }, [data.limit, data.repo, data.since, data.state])

  return (
    <div className="surface-soft flex min-w-0 items-center gap-3 rounded-lg px-4 py-2.5 text-xs text-zinc-500">
      <code className="min-w-0 truncate font-mono text-zinc-300">{command}</code>
    </div>
  )
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{title}</h2>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
    </div>
  )
}

const LOW_VALUE_FLAGS = new Set([
  'readme_only_noise',
  'docs_rewrite_noise',
  'dependency_without_usage',
  'lockfile_only',
  'formatting_churn',
  'test_only_mock_inflation',
  'description_too_generic',
  'patch_text_mismatch',
  'claim_tests_missing',
  'claim_perf_but_formatting',
])

function normalizeLogin(value: string | null | undefined) {
  return (value ?? '').trim().replace(/^@/, '').toLowerCase()
}

function excludedStorageKey(slug: string | null) {
  return `triage.excludedUsers.${slug ?? 'default'}`
}

function readExcludedUsers(slug: string | null) {
  try {
    const parsed = JSON.parse(localStorage.getItem(excludedStorageKey(slug)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map((item) => normalizeLogin(String(item))).filter(Boolean))].sort()
  } catch {
    return []
  }
}

function summarizePrs(prs: PullRequest[]): SignalSummary {
  const flagCounts: Record<string, number> = {}
  const fileBucketCounts: Record<string, number> = {
    code: 0,
    tests: 0,
    docs: 0,
    config: 0,
    lockfile: 0,
    generated: 0,
    other: 0,
  }
  let lowValuePrs = 0
  let riskyNewContributorPrs = 0
  let lowTrustPrs = 0
  let trustTotal = 0

  prs.forEach((pr) => {
    let hasLowValueFlag = false
    pr.flags.forEach((flag) => {
      flagCounts[flag] = (flagCounts[flag] ?? 0) + 1
      if (LOW_VALUE_FLAGS.has(flag)) hasLowValueFlag = true
    })
    Object.entries(pr.signals.fileBuckets).forEach(([bucket, count]) => {
      fileBucketCounts[bucket] = (fileBucketCounts[bucket] ?? 0) + count
    })
    if (hasLowValueFlag) lowValuePrs += 1
    if (pr.flags.includes('new_contributor_high_risk')) riskyNewContributorPrs += 1
    if (pr.contributorTrust.score < 45) lowTrustPrs += 1
    trustTotal += pr.contributorTrust.score
  })

  return {
    flagCounts,
    fileBucketCounts,
    lowValuePrs,
    riskyNewContributorPrs,
    lowTrustPrs,
    averageContributorTrust: prs.length ? trustTotal / prs.length : null,
  }
}

function applyExcludedUsers(prs: PullRequest[], excludedUsers: Set<string>) {
  if (excludedUsers.size === 0) return prs
  return prs.map((pr) => {
    if (!excludedUsers.has(normalizeLogin(pr.author.login))) return pr
    return {
      ...pr,
      flags: [],
      signals: {
        ...pr.signals,
        reviewState: 'excluded',
      },
      contributorTrust: {
        ...pr.contributorTrust,
        bucket: 'high' as const,
        score: Math.max(pr.contributorTrust.score, 100),
        positives: ['Excluded in local trusted-user settings', ...pr.contributorTrust.positives],
        risks: [],
        explanation: 'Excluded in local trusted-user settings.',
      },
      recommendation: {
        bucket: 'excluded',
        score: 100,
        confidence: 1,
        reasons: ['Excluded in local trusted-user settings'],
        risks: [],
        scoreBreakdown: {},
      },
      alignment: pr.alignment
        ? {
            ...pr.alignment,
            signals: [],
          }
        : pr.alignment,
    }
  })
}

function filterWavesForExcluded(
  waves: FloodWave[],
  excludedUsers: Set<string>,
  sourcePrs: PullRequest[],
) {
  if (excludedUsers.size === 0) return waves
  const byNumber = new Map(sourcePrs.map((pr) => [pr.number, pr]))
  return waves
    .map((wave) => {
      const prs = wave.prs.filter((number) => {
        const pr = byNumber.get(number)
        return pr ? !excludedUsers.has(normalizeLogin(pr.author.login)) : true
      })
      const members = wave.members?.filter((member) => prs.includes(member.number))
      if (prs.length === wave.prs.length) return wave
      const bestPr = prs.includes(wave.bestPr) ? wave.bestPr : prs[0]
      const best = bestPr ? byNumber.get(bestPr) : null
      const originPr = wave.originPr && prs.includes(wave.originPr) ? wave.originPr : null
      return {
        ...wave,
        prs,
        members,
        bestPr: bestPr ?? wave.bestPr,
        bestTitle: best?.title ?? wave.bestTitle,
        originPr,
      }
    })
    .filter((wave) => wave.prs.length >= 3)
}

function filterClustersForExcluded(
  clusters: PrCluster[],
  excludedUsers: Set<string>,
  sourcePrs: PullRequest[],
) {
  if (excludedUsers.size === 0) return clusters
  const byNumber = new Map(sourcePrs.map((pr) => [pr.number, pr]))
  return clusters
    .map((cluster) => {
      const prs = cluster.prs.filter((number) => {
        const pr = byNumber.get(number)
        return pr ? !excludedUsers.has(normalizeLogin(pr.author.login)) : true
      })
      const members = cluster.members?.filter((member) => prs.includes(member.number))
      if (prs.length === cluster.prs.length) return cluster
      const bestPr = prs.includes(cluster.bestPr) ? cluster.bestPr : prs[0]
      const best = bestPr ? byNumber.get(bestPr) : null
      return {
        ...cluster,
        prs,
        members,
        size: prs.length,
        bestPr: bestPr ?? cluster.bestPr,
        bestTitle: best?.title ?? cluster.bestTitle,
      }
    })
    .filter((cluster) => cluster.prs.length >= 2)
}

export default function App() {
  const { repos, loading: loadingRepos } = useRepos()
  const [selectedSlugOverride, setSelectedSlugOverride] = useState<string | null>(null)
  const selectedSlug = selectedSlugOverride ?? repos[0]?.slug ?? null
  const { data, loading: loadingData, runAiAction } = useRepoData(selectedSlug)
  const [selectedPrState, setSelectedPrState] = useState<{
    repoSlug: string | null
    pr: PullRequest
  } | null>(null)
  const [page, setPage] = useState<PageKey>('overview')
  const [runningReviewPlan, setRunningReviewPlan] = useState(false)
  const [reviewPlanError, setReviewPlanError] = useState<string | null>(null)
  const [excludedUsersBySlug, setExcludedUsersBySlug] = useState<Record<string, string[]>>({})

  const excludedUsers = useMemo(
    () => excludedUsersBySlug[selectedSlug ?? 'default'] ?? readExcludedUsers(selectedSlug),
    [excludedUsersBySlug, selectedSlug],
  )
  const excludedUserSet = useMemo(() => new Set(excludedUsers.map(normalizeLogin)), [excludedUsers])
  const effectivePrs = useMemo(
    () => (data ? applyExcludedUsers(data.prs, excludedUserSet) : []),
    [data, excludedUserSet],
  )
  const effectiveSummary = useMemo(() => summarizePrs(effectivePrs), [effectivePrs])
  const effectiveData = useMemo(
    () => (data ? { ...data, prs: effectivePrs, signalSummary: effectiveSummary } : null),
    [data, effectivePrs, effectiveSummary],
  )
  const floodWaves = useMemo(
    () =>
      data
        ? filterWavesForExcluded(
            data.analysis?.floodWaves ?? buildAiFloodWaves(effectivePrs),
            excludedUserSet,
            data.prs,
          )
        : [],
    [data, effectivePrs, excludedUserSet],
  )
  const floodClusters = useMemo(
    () =>
      data
        ? filterClustersForExcluded(
            data.analysis?.clusters ?? buildFloodClusters(effectivePrs, floodWaves),
            excludedUserSet,
            data.prs,
          )
        : [],
    [data, effectivePrs, excludedUserSet, floodWaves],
  )
  const clusters = useMemo(
    () =>
      data
        ? filterClustersForExcluded(
            data.analysis?.clusters ?? buildPrClusters(effectivePrs),
            excludedUserSet,
            data.prs,
          )
        : [],
    [data, effectivePrs, excludedUserSet],
  )
  const trends = useMemo(() => (effectiveData ? buildTrendReport(effectiveData.prs) : null), [effectiveData])
  const floodPrNumbers = useMemo(
    () => new Set(floodWaves.flatMap((wave) => wave.prs)),
    [floodWaves],
  )
  const latestRecommendation = data?.ai?.recommendations[0]
  const selectedPr = useMemo(() => {
    if (selectedPrState?.repoSlug !== selectedSlug) return null
    return effectivePrs.find((pr) => pr.number === selectedPrState.pr.number) ?? selectedPrState.pr
  }, [effectivePrs, selectedPrState, selectedSlug])
  const selectPr = (pr: PullRequest) => setSelectedPrState({ repoSlug: selectedSlug, pr })

  function updateExcludedUsers(users: string[]) {
    const normalized = [...new Set(users.map(normalizeLogin).filter(Boolean))].sort()
    setExcludedUsersBySlug((current) => ({
      ...current,
      [selectedSlug ?? 'default']: normalized,
    }))
    localStorage.setItem(excludedStorageKey(selectedSlug), JSON.stringify(normalized))
  }

  async function runReviewPlan() {
    setRunningReviewPlan(true)
    setReviewPlanError(null)
    try {
      await runAiAction({ action: 'recommend', limit: 5 })
    } catch (e) {
      setReviewPlanError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunningReviewPlan(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#030303]">
      <Header repos={repos} selected={selectedSlug} onSelect={setSelectedSlugOverride} />

      <main className="flex-1">
        {loadingRepos || loadingData ? (
          <Loading />
        ) : !data ? (
          <EmptyState />
        ) : (
          <div className="flex w-full flex-col gap-5 px-5 py-5 sm:px-6 lg:px-8">
            <div className="grid w-full gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
              <Sidebar
                active={page}
                onChange={setPage}
                counts={{
                  prs: effectiveData?.prs.length ?? data.prs.length,
                  flood: floodClusters.length,
                  clusters: clusters.length,
                }}
              />

              <section className="min-w-0">
                {page === 'overview' && (
                  <div className="space-y-5">
                    <ScanHeader data={effectiveData ?? data} />
                    <Metrics data={effectiveData ?? data} floodWaves={floodWaves} />
                    <CommandStrip data={data} />
                    <AiReviewPlan
                      batch={latestRecommendation}
                      prs={effectiveData?.prs ?? data.prs}
                      onSelect={selectPr}
                      onRun={runReviewPlan}
                      running={runningReviewPlan}
                      error={reviewPlanError}
                    />
                    <section className="surface rounded-lg p-4 sm:p-5">
                      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-400">
                            Signal surface
                          </h2>
                          <p className="mt-1 text-sm text-zinc-500">
                            File mix and deterministic flags folded into the current scan.
                          </p>
                        </div>
                        <div className="text-xs text-zinc-600">
                          {Object.keys((effectiveData ?? data).signalSummary.flagCounts).length} flag types
                        </div>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.05fr)]">
                        <FileBucketsChart summary={(effectiveData ?? data).signalSummary} embedded />
                        <FlagsList summary={(effectiveData ?? data).signalSummary} embedded />
                      </div>
                    </section>
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                      <FocusQueue
                        prs={effectiveData?.prs ?? data.prs}
                        onSelect={selectPr}
                        limit={4}
                        actionLabel="Open queue"
                        onAction={() => setPage('queue')}
                      />
                      <FloodWaves
                        waves={floodWaves}
                        prs={effectiveData?.prs ?? data.prs}
                        clusters={floodClusters}
                        onSelect={selectPr}
                        limit={3}
                        actionLabel="Open flood"
                        onAction={() => setPage('flood')}
                      />
                    </div>
                  </div>
                )}

                {page === 'queue' && (
                  <div className="w-full">
                    <PageHeader
                      title="Review Queue"
                      description="Search, sort, and filter cached pull requests without the overview noise."
                    />
                    <PrList
                      prs={effectiveData?.prs ?? data.prs}
                      selected={selectedPr}
                      onSelect={selectPr}
                      floodPrNumbers={floodPrNumbers}
                      ai={data.ai}
                      pageMode
                    />
                  </div>
                )}

                {page === 'flood' && (
                  <>
                    <PageHeader
                      title="AI Flood"
                      description="Burst patterns from cached PR timing, repeated files, changelets, low context, and trust signals."
                    />
                    <FloodWaves
                      waves={floodWaves}
                      prs={effectiveData?.prs ?? data.prs}
                      clusters={floodClusters}
                      onSelect={selectPr}
                      limit={30}
                      pageMode
                    />
                  </>
                )}

                {page === 'stats' && trends && (
                  <StatsPage
                    data={effectiveData ?? data}
                    clusters={clusters}
                    trends={trends}
                    floodWaves={floodWaves}
                    onSelect={selectPr}
                  />
                )}

                {page === 'settings' && (
                  <SettingsPage
                    repo={data.repo}
                    excludedUsers={excludedUsers}
                    onChange={updateExcludedUsers}
                  />
                )}
              </section>
            </div>
          </div>
        )}
      </main>

      <PrDetail
        key={selectedPr?.number ?? 'empty'}
        pr={selectedPr}
        prs={effectiveData?.prs ?? data?.prs}
        clusters={clusters}
        ai={data?.ai}
        onRunAi={runAiAction}
        onClose={() => setSelectedPrState(null)}
      />

      <footer className="border-t border-zinc-900/90 py-5 text-center text-xs text-zinc-700">
        Triage visualizer
      </footer>
    </div>
  )
}
