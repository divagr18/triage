import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'

interface Props {
  repo: string
  excludedUsers: string[]
  onChange: (users: string[]) => void
}

function normalizeUsers(value: string) {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
}

export function SettingsPage({ repo, excludedUsers, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const sortedUsers = useMemo(() => [...excludedUsers].sort(), [excludedUsers])

  function addUsers() {
    const next = new Set(sortedUsers)
    normalizeUsers(draft).forEach((user) => next.add(user))
    onChange([...next].sort())
    setDraft('')
  }

  function removeUser(user: string) {
    onChange(sortedUsers.filter((item) => item !== user))
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">Settings</h2>
        <p className="mt-2 text-sm text-zinc-400">Local view controls for {repo}.</p>
      </div>

      <section className="surface rounded-lg p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(360px,1.2fr)]">
          <div>
            <h3 className="text-sm font-semibold text-white">Trusted user exclusions</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
              Excluded authors stay visible, but their PRs are removed from risk counts, flags, focus queues,
              and flood clusters in this browser view.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addUsers()
                }}
                placeholder="Add usernames, comma separated"
                className="min-h-11 flex-1 rounded-md border border-zinc-800 bg-black/25 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-500/50"
              />
              <button
                onClick={addUsers}
                disabled={normalizeUsers(draft).length === 0}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-sky-500/25 bg-sky-500/10 px-4 text-sm font-medium text-sky-100 transition hover:border-sky-400/45 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Plus size={16} />
                Add
              </button>
            </div>

            {sortedUsers.length === 0 ? (
              <div className="rounded-md border border-zinc-800 bg-black/20 px-3 py-5 text-sm text-zinc-500">
                No excluded users for this repo.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedUsers.map((user) => (
                  <span
                    key={user}
                    className="inline-flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1.5 text-sm text-emerald-100/90"
                  >
                    @{user}
                    <button
                      onClick={() => removeUser(user)}
                      className="rounded text-emerald-100/55 transition hover:bg-emerald-500/15 hover:text-emerald-50"
                      aria-label={`Remove ${user}`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
