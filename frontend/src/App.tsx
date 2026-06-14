import { useMemo, useState } from 'react'
import { Database, Loader2 } from 'lucide-react'
import { Header } from './components/Header'
import { Metrics } from './components/Metrics'
import { FileBucketsChart } from './components/FileBucketsChart'
import { FlagsList } from './components/FlagsList'
import { FocusQueue } from './components/FocusQueue'
import { FloodWaves } from './components/FloodWaves'
import { PrList } from './components/PrList'
import { PrDetail } from './components/PrDetail'
import { Sidebar, type PageKey } from './components/Sidebar'
import { StatsPage } from './components/StatsPage'
import { useRepos, useRepoData } from './useTriageData'
import type { PullRequest, TriageCache } from './types'
import { buildAiFloodWaves, buildPrClusters, buildTrendReport } from './utils'

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

export default function App() {
  const { repos, loading: loadingRepos } = useRepos()
  const [selectedSlugOverride, setSelectedSlugOverride] = useState<string | null>(null)
  const selectedSlug = selectedSlugOverride ?? repos[0]?.slug ?? null
  const { data, loading: loadingData } = useRepoData(selectedSlug)
  const [selectedPrState, setSelectedPrState] = useState<{
    repoSlug: string | null
    pr: PullRequest
  } | null>(null)
  const [page, setPage] = useState<PageKey>('overview')

  const selectedPr = selectedPrState?.repoSlug === selectedSlug ? selectedPrState.pr : null
  const selectPr = (pr: PullRequest) => setSelectedPrState({ repoSlug: selectedSlug, pr })
  const floodWaves = useMemo(() => (data ? buildAiFloodWaves(data.prs) : []), [data])
  const clusters = useMemo(() => (data ? buildPrClusters(data.prs) : []), [data])
  const trends = useMemo(() => (data ? buildTrendReport(data.prs) : null), [data])
  const floodPrNumbers = useMemo(
    () => new Set(floodWaves.flatMap((wave) => wave.prs)),
    [floodWaves],
  )

  return (
    <div className="flex min-h-screen flex-col bg-[#030303]">
      <Header repos={repos} selected={selectedSlug} onSelect={setSelectedSlugOverride} />

      <main className="flex-1">
        {loadingRepos || loadingData ? (
          <Loading />
        ) : !data ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-5 py-5 sm:px-6 lg:px-8">
            <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
              <Sidebar
                active={page}
                onChange={setPage}
                counts={{
                  prs: data.prs.length,
                  flood: floodWaves.length,
                  clusters: clusters.length,
                }}
              />

              <section className="min-w-0">
                {page === 'overview' && (
                  <div className="space-y-5">
                    <ScanHeader data={data} />
                    <Metrics data={data} floodWaves={floodWaves} />
                    <CommandStrip data={data} />
                    <section>
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold tracking-tight text-zinc-50">Signals</h2>
                        <p className="mt-1 text-sm text-zinc-400">
                          File mix and deterministic flags for the current scan.
                        </p>
                      </div>
                      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <FileBucketsChart summary={data.signalSummary} />
                        <FlagsList summary={data.signalSummary} />
                      </div>
                    </section>
                    <div className="grid gap-5 xl:grid-cols-2">
                      <FocusQueue
                        prs={data.prs}
                        onSelect={selectPr}
                        limit={4}
                        actionLabel="Open queue"
                        onAction={() => setPage('queue')}
                      />
                      <FloodWaves
                        waves={floodWaves}
                        prs={data.prs}
                        clusters={clusters}
                        onSelect={selectPr}
                        limit={3}
                        actionLabel="Open flood"
                        onAction={() => setPage('flood')}
                      />
                    </div>
                  </div>
                )}

                {page === 'queue' && (
                  <div className="max-w-5xl">
                    <PageHeader
                      title="Review Queue"
                      description="Search, sort, and filter cached pull requests without the overview noise."
                    />
                    <PrList
                      prs={data.prs}
                      selected={selectedPr}
                      onSelect={selectPr}
                      floodPrNumbers={floodPrNumbers}
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
                      prs={data.prs}
                      clusters={clusters}
                      onSelect={selectPr}
                      limit={30}
                      pageMode
                    />
                  </>
                )}

                {page === 'stats' && trends && (
                  <StatsPage
                    data={data}
                    clusters={clusters}
                    trends={trends}
                    floodWaves={floodWaves}
                    onSelect={selectPr}
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
        onClose={() => setSelectedPrState(null)}
      />

      <footer className="border-t border-zinc-900/90 py-5 text-center text-xs text-zinc-700">
        Triage visualizer
      </footer>
    </div>
  )
}
