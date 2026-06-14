import { useMemo, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import type { AiCache, PullRequest } from '../types'
import { PrCard } from './PrCard'
import { isTrustedCleanPr, sortPrs, type SortKey } from '../utils'

interface Props {
  prs: PullRequest[]
  selected: PullRequest | null
  onSelect: (pr: PullRequest) => void
  floodPrNumbers: Set<number>
  ai?: AiCache
  pageMode?: boolean
}

export function PrList({ prs, selected, onSelect, floodPrNumbers, ai, pageMode = false }: Props) {
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
    if (filter === 'ai-mismatch') {
      result = result.filter(
        (pr) =>
          pr.flags.some((flag) => flag.includes('patch_text') || flag.startsWith('claim_')) ||
          pr.alignment?.verdict === 'mismatch' ||
          pr.alignment?.estimatedVerdict === 'mismatch',
      )
    }
    return sortPrs(result, sort)
  }, [prs, query, sort, filter, floodPrNumbers])

  return (
    <section
      className={`surface flex min-w-0 flex-col rounded-lg p-5 sm:p-6 ${
        pageMode ? 'xl:h-[calc(100vh-10rem)]' : 'xl:max-h-[calc(100vh-23rem)]'
      }`}
    >
      <div className="mb-6 shrink-0 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Pull Requests</h2>
          <p className="mt-1.5 text-sm text-zinc-400">
            {filtered.length} shown from {prs.length} cached PRs
          </p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative md:w-80">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, author, #..."
              className="h-10 w-full rounded-md border border-zinc-700/80 bg-zinc-950/80 pl-9 pr-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 hover:border-zinc-600 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="hidden text-zinc-400 md:block" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
              className="h-10 min-w-[9rem] appearance-none rounded-md border border-zinc-700/80 bg-zinc-950/80 px-3 pr-7 text-sm text-zinc-100 outline-none hover:border-zinc-600"
            >
              <option value="all">All PRs</option>
              <option value="flagged">Flagged</option>
              <option value="low-trust">Low trust</option>
              <option value="needs-review">Needs review</option>
              <option value="trusted-clean">Trusted clean</option>
              <option value="ai-flood">AI flood</option>
              <option value="ai-mismatch">AI mismatch</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-10 min-w-[9rem] appearance-none rounded-md border border-zinc-700/80 bg-zinc-950/80 px-3 pr-7 text-sm text-zinc-100 outline-none hover:border-zinc-600"
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

      <div
        className={`overflow-y-auto pr-2 xl:min-h-0 xl:flex-1 ${
          pageMode ? 'grid content-start gap-4 xl:grid-cols-2 2xl:grid-cols-3' : 'space-y-4'
        }`}
      >
        {filtered.map((pr) => (
          <PrCard
            key={pr.number}
            pr={pr}
            selected={selected?.number === pr.number}
            aiAlignment={ai?.alignment[String(pr.number)]}
            aiExplain={ai?.explain[String(pr.number)]}
            onClick={() => onSelect(pr)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-10 text-center">
            <p className="text-sm text-zinc-400">No pull requests match your filters.</p>
          </div>
        )}
      </div>
    </section>
  )
}

type FilterKey = 'all' | 'flagged' | 'low-trust' | 'needs-review' | 'trusted-clean' | 'ai-flood' | 'ai-mismatch'
