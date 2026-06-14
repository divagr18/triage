import { useEffect, useState } from 'react'
import type { RepoMeta, TriageCache } from './types'

export function useRepos() {
  const [repos, setRepos] = useState<RepoMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/repos')
      .then((r) => r.json())
      .then((data) => setRepos(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return { repos, loading, error }
}

export function useRepoData(slug: string | null) {
  const [data, setData] = useState<TriageCache | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) {
      return
    }
    let cancelled = false

    async function loadRepo() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/repos/${slug}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const nextData = await response.json()
        if (!cancelled) setData(nextData)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadRepo()
    return () => {
      cancelled = true
    }
  }, [slug])

  return { data: slug ? data : null, loading, error }
}
