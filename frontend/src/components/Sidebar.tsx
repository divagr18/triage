export type PageKey = 'overview' | 'queue' | 'flood'

interface Props {
  active: PageKey
  onChange: (page: PageKey) => void
  counts: {
    prs: number
    flood: number
  }
}

const ITEMS: Array<{
  key: PageKey
  label: string
  description: string
}> = [
  { key: 'overview', label: 'Overview', description: 'scan health' },
  { key: 'queue', label: 'Queue', description: 'PR worklist' },
  { key: 'flood', label: 'AI Flood', description: 'burst waves' },
]

export function Sidebar({ active, onChange, counts }: Props) {
  const badgeFor = (key: PageKey) => {
    if (key === 'queue') return counts.prs
    if (key === 'flood') return counts.flood
    return null
  }

  return (
    <aside className="surface-soft shrink-0 rounded-lg p-2 xl:w-60">
      <nav className="grid grid-cols-2 gap-1 xl:grid-cols-1">
        {ITEMS.map((item) => {
          const badge = badgeFor(item.key)
          const selected = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                selected
                  ? 'border-zinc-700 bg-zinc-900/65 text-zinc-50'
                  : 'border-transparent text-zinc-500 hover:bg-zinc-900/35 hover:text-zinc-200'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="hidden text-xs text-zinc-600 xl:block">{item.description}</span>
              </span>
              {badge !== null && (
                <span className="rounded border border-zinc-800 bg-black/25 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
