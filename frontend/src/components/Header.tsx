import { ChevronDown, GitBranch, GitPullRequest } from 'lucide-react'
import type { RepoMeta } from '../types'

interface Props {
  repos: RepoMeta[]
  selected: string | null
  onSelect: (slug: string) => void
}

export function Header({ repos, selected, onSelect }: Props) {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between px-5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-black shadow-[0_0_24px_rgba(255,255,255,0.16)]">
            <GitPullRequest size={18} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white">Triage</h1>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Maintainer cockpit
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {repos.length > 0 ? (
            <div className="relative">
              <GitBranch
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <select
                value={selected ?? ''}
                onChange={(e) => onSelect(e.target.value)}
                className="h-9 min-w-52 appearance-none rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-9 text-sm text-zinc-200 outline-none transition hover:border-zinc-700 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              >
                <option value="" disabled>
                  Select repository
                </option>
                {repos.map((repo) => (
                  <option key={repo.slug} value={repo.slug}>
                    {repo.repo}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
            </div>
          ) : (
            <span className="text-sm text-zinc-500">No cached repos</span>
          )}
        </div>
      </div>
    </header>
  )
}
