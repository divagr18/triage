import { useMemo, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import type { PullRequest } from '../types'
import { PrCard } from './PrCard'
import { isTrustedCleanPr, sortPrs, type SortKey } from '../utils'

interface Props {
  prs: PullRequest[]
  selected: PullRequest | null
  onSelect: (pr: PullRequest) => void
  floodPrNumbers: Set<number>
}

export function PrList({ prs, selected, onSelect, floodPrNumbers }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [filter, setFilter] = useState<FilterKey>('all')

  const filtered = useMemo(() => {
    let result = prs
    const q = query.toLowerCase()
    if (q) {
      result = result.filter(
        (pr) =>
          pr.title.toLowerCase().includes(q) ||
          pr.author.login.toLowerCase().includes(q) ||
          pr.number.toString().includes(q),
      )
    }
    if (filter === 'flagged') result = result.filter((pr) => pr.flags.length > 0)
    if (filter === 'low-trust') result = result.filter((pr) => pr.contributorTrust.score < 55)
    if (filter === 'needs-review') result = result.filter((pr) => pr.signals.reviewState === 'none')
    if (filter === 'trusted-clean') result = result.filter(isTrustedCleanPr)
    if (filter === 'ai-flood') result = result.filter((pr) => floodPrNumbers.has(pr.number))
    return sortPrs(result, sort)
  }, [prs, query, sort, filter, floodPrNumbers])

  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-zinc-800/80 bg-zinc-950/45 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.28)] sm:p-5 xl:max-h-[calc(100vh-23rem)]">
      <div className="mb-5 shrink-0 flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Pull Requests</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {filtered.length} shown from {prs.length} cached PRs
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, author, #..."
              className="h-9 w-full rounded-md border border-zinc-800 bg-black/40 pl-9 pr-4 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 hover:border-zinc-700 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 lg:w-72"
            />
          </div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="hidden text-zinc-500 lg:block" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
              className="h-9 min-w-[8.5rem] appearance-none rounded-md border border-zinc-800 bg-black/40 px-3 pr-7 text-sm text-zinc-200 outline-none hover:border-zinc-700"
            >
              <option value="all">All PRs</option>
              <option value="flagged">Flagged</option>
              <option value="low-trust">Low trust</option>
              <option value="needs-review">Needs review</option>
              <option value="trusted-clean">Trusted clean</option>
              <option value="ai-flood">AI flood</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-9 min-w-[8.5rem] appearance-none rounded-md border border-zinc-800 bg-black/40 px-3 pr-7 text-sm text-zinc-200 outline-none hover:border-zinc-700"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="trust-high">Trust: high</option>
              <option value="trust-low">Trust: low</option>
              <option value="changes">Most changes</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-1 2xl:grid-cols-2 xl:min-h-0 xl:flex-1">
        {filtered.map((pr) => (
          <PrCard
            key={pr.number}
            pr={pr}
            selected={selected?.number === pr.number}
            onClick={() => onSelect(pr)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-10 text-center 2xl:col-span-2">
            <p className="text-sm text-zinc-500">No pull requests match your filters.</p>
          </div>
        )}
      </div>
    </section>
  )
}

type FilterKey = 'all' | 'flagged' | 'low-trust' | 'needs-review' | 'trusted-clean' | 'ai-flood'
