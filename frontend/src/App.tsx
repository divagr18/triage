import { useMemo, useState } from 'react'
import { Database, GitPullRequest, Loader2, TerminalSquare } from 'lucide-react'
import { Header } from './components/Header'
import { Metrics } from './components/Metrics'
import { FileBucketsChart } from './components/FileBucketsChart'
import { FlagsList } from './components/FlagsList'
import { FocusQueue } from './components/FocusQueue'
import { PrList } from './components/PrList'
import { PrDetail } from './components/PrDetail'
import { useRepos, useRepoData } from './useTriageData'
import type { PullRequest, TriageCache } from './types'

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
    <section className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.26)] sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-black/35 px-2.5 py-1">
              <GitPullRequest size={12} />
              {data.state}
            </span>
            <span className="rounded-md border border-zinc-800 bg-black/35 px-2.5 py-1">
              schema v{data.schemaVersion}
            </span>
            <span className="rounded-md border border-zinc-800 bg-black/35 px-2.5 py-1">
              {source}
            </span>
          </div>
          <h2 className="truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {data.repo}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">Scanned {scannedAt}</p>
        </div>

        <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-3 lg:min-w-[460px]">
          <div className="rounded-md border border-zinc-800 bg-black/30 p-3">
            <div className="mb-1 font-medium text-zinc-300">Cache</div>
            <div className="truncate">{data.limit} PR limit</div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-black/30 p-3">
            <div className="mb-1 font-medium text-zinc-300">Window</div>
            <div className="truncate">{data.since || 'latest available'}</div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-black/30 p-3">
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
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-800/80 bg-black/40 px-4 py-3 text-xs text-zinc-500">
      <TerminalSquare size={15} className="shrink-0 text-zinc-400" />
      <code className="min-w-0 truncate font-mono text-zinc-300">{command}</code>
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

  const selectedPr = selectedPrState?.repoSlug === selectedSlug ? selectedPrState.pr : null
  const selectPr = (pr: PullRequest) => setSelectedPrState({ repoSlug: selectedSlug, pr })

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,#171717_0,#050505_38%,#000_72%)]">
      <Header repos={repos} selected={selectedSlug} onSelect={setSelectedSlugOverride} />

      <main className="flex-1">
        {loadingRepos || loadingData ? (
          <Loading />
        ) : !data ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-[1800px] flex-col gap-6 px-5 py-6 sm:px-6 lg:px-8">
            <ScanHeader data={data} />
            <Metrics data={data} />
            <CommandStrip data={data} />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_430px]">
              <PrList prs={data.prs} selected={selectedPr} onSelect={selectPr} />
              <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
                <FocusQueue prs={data.prs} onSelect={selectPr} />
                <FileBucketsChart summary={data.signalSummary} />
                <FlagsList summary={data.signalSummary} />
              </aside>
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
